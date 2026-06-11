<?php
/**
 * project_dashboard.php
 * 
 * MAIN PROJECT DASHBOARD WITH 5 TOP-LEVEL TABS
 * 
 * TOP NAVIGATION: Overview | Documents | Takeoff | Estimating | Proposal
 * 
 * Each tab is a complete view within the project context.
 * Takeoff has 2 internal slides:
 *   - Slide 1: Drawing Takeoff (plan view + layers panel + toolbar)
 *   - Slide 2: Estimate Summary (cost table + totals)
 */

require_once __DIR__ . '/../core/db/connection.php';

$projectId = (int)($_GET['id'] ?? $_GET['project_id'] ?? 0);
$activeTab = $_GET['tab'] ?? 'overview';
$takeoffSlide = $_GET['slide'] ?? 'drawing'; // 'drawing' or 'summary'

// Fetch project data
$projectStmt = $pdo->prepare("
    SELECT * FROM projects 
    WHERE id = ? AND deleted_at IS NULL
");
$projectStmt->execute([$projectId]);
$project = $projectStmt->fetch(PDO::FETCH_ASSOC);

if (!$project) {
    http_response_code(404);
    die("Project not found");
}

// Fetch related data based on active tab
$drawings = [];
$takeoffs = [];
$estimates = [];
$documents = [];
$proposals = [];
$estimateItems = [];
$takeoffLayers = [];
$takeoffMeasurements = [];

if ($activeTab === 'documents') {
    $stmt = $pdo->prepare("
        SELECT * FROM project_documents 
        WHERE project_id = ? AND deleted_at IS NULL 
        ORDER BY created_at DESC
    ");
    $stmt->execute([$projectId]);
    $documents = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

if ($activeTab === 'takeoff') {
    // Fetch drawings
    $stmt = $pdo->prepare("
        SELECT * FROM drawings 
        WHERE project_id = ? AND deleted_at IS NULL 
        ORDER BY drawing_number ASC
    ");
    $stmt->execute([$projectId]);
    $drawings = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Fetch takeoffs
    $stmt = $pdo->prepare("
        SELECT * FROM takeoffs 
        WHERE project_id = ? AND deleted_at IS NULL 
        ORDER BY name ASC
    ");
    $stmt->execute([$projectId]);
    $takeoffs = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // If takeoff slide is "summary", get estimate items
    if ($takeoffSlide === 'summary' && !empty($takeoffs)) {
        $takeoffId = $takeoffs[0]['id'];
        
        // Get all layers for this takeoff
        $stmt = $pdo->prepare("
            SELECT * FROM takeoff_layers 
            WHERE takeoff_id = ? AND deleted_at IS NULL 
            ORDER BY sort_order ASC
        ");
        $stmt->execute([$takeoffId]);
        $takeoffLayers = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Get measurements
        $stmt = $pdo->prepare("
            SELECT tm.*, tl.name as layer_name
            FROM takeoff_measurements tm
            LEFT JOIN takeoff_layers tl ON tl.id = tm.takeoff_layer_id
            WHERE tm.takeoff_id = ? AND tm.deleted_at IS NULL 
            ORDER BY tm.created_at DESC
        ");
        $stmt->execute([$takeoffId]);
        $takeoffMeasurements = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Get estimate items related to this takeoff
        $stmt = $pdo->prepare("
            SELECT ei.*, ci.name as catalog_item_name
            FROM estimate_items ei
            LEFT JOIN takeoff_layers tl ON tl.id = ei.takeoff_layer_id
            LEFT JOIN catalog_items ci ON ci.id = ei.catalog_item_id
            WHERE tl.takeoff_id = ? AND ei.deleted_at IS NULL 
            ORDER BY ei.sort_order ASC
        ");
        $stmt->execute([$takeoffId]);
        $estimateItems = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}

if ($activeTab === 'estimating') {
    $stmt = $pdo->prepare("
        SELECT * FROM estimating 
        WHERE project_id = ? AND deleted_at IS NULL 
        ORDER BY name ASC
    ");
    $stmt->execute([$projectId]);
    $estimates = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

if ($activeTab === 'proposal') {
    $stmt = $pdo->prepare("
        SELECT * FROM proposals 
        WHERE project_id = ? AND deleted_at IS NULL 
        ORDER BY created_at DESC
    ");
    $stmt->execute([$projectId]);
    $proposals = $stmt->fetchAll(PDO::FETCH_ASSOC);
} 
?>

<?php

?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars($project['name']) ?> - Project Dashboard | Takeoff</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b1120;
            --panel: #111827;
            --card: #1e293b;
            --line: rgba(148, 163, 184, 0.2);
            --text: #f8fafc;
            --muted: #94a3b8;
            --primary: #2563eb;
            --accent: #0ea5e9;
        }
        body {
            background: var(--bg);
            color: var(--text);
            font-family: Outfit, system-ui, sans-serif;
            margin: 0;
            padding: 0;
        }
        .project-header {
            background: linear-gradient(135deg, rgba(37, 99, 235, 0.1) 0%, rgba(14, 165, 233, 0.1) 100%);
            border-bottom: 1px solid var(--line);
            padding: 2rem;
        }
        .project-title-section h1 {
            font-size: 1.8rem;
            font-weight: 800;
            margin: 0 0 0.5rem 0;
        }
        .project-title-section p {
            margin: 0;
            color: var(--muted);
            font-size: 0.9rem;
        }
        .project-nav {
            background: var(--panel);
            border-bottom: 1px solid var(--line);
            padding: 0;
            display: flex;
            gap: 0;
            overflow-x: auto;
            flex-wrap: nowrap;
        }
        .project-nav a {
            flex: 0 0 auto;
            padding: 1rem 1.5rem;
            color: var(--muted);
            text-decoration: none;
            border-bottom: 2px solid transparent;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            white-space: nowrap;
            font-weight: 500;
        }
        .project-nav a:hover {
            color: var(--text);
            background: rgba(37, 99, 235, 0.1);
        }
        .project-nav a.active {
            color: var(--primary);
            border-bottom-color: var(--primary);
            background: rgba(37, 99, 235, 0.15);
        }
        .project-nav i {
            font-size: 1rem;
        }
        .project-content {
            padding: 2rem;
            min-height: calc(100vh - 300px);
        }
        
        /* TAKEOFF INTERNAL VIEWS */
        .takeoff-slides-nav {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
            border-bottom: 1px solid var(--line);
            padding-bottom: 1rem;
        }
        .takeoff-slide-btn {
            padding: 0.75rem 1.5rem;
            background: transparent;
            border: 1px solid var(--line);
            color: var(--muted);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 600;
            text-decoration: none;
        }
        .takeoff-slide-btn:hover {
            color: var(--text);
            border-color: var(--primary);
        }
        .takeoff-slide-btn.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }
        
        /* DRAWING TAKEOFF VIEW */
        .drawing-view {
            display: grid;
            grid-template-columns: 300px 1fr 200px;
            gap: 1rem;
            height: 60vh;
        }
        .takeoff-panel-left {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 1rem;
            overflow-y: auto;
        }
        .takeoff-panel-left h5 {
            font-weight: 700;
            margin-bottom: 1rem;
        }
        .takeoff-panel-left input {
            background: var(--bg);
            border: 1px solid var(--line);
            color: var(--text);
            margin-bottom: 1rem;
            border-radius: 4px;
        }
        .takeoff-panel-left .btn {
            width: 100%;
            margin-bottom: 1rem;
        }
        .drawing-canvas {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--muted);
            position: relative;
        }
        .drawing-canvas-placeholder {
            text-align: center;
        }
        .drawing-canvas-placeholder i {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.3;
        }
        .takeoff-toolbar-right {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .takeoff-toolbar-right h5 {
            font-weight: 700;
            margin: 0 0 1rem 0;
        }
        .takeoff-toolbar-right button {
            padding: 0.75rem;
            background: rgba(37, 99, 235, 0.2);
            border: 1px solid var(--primary);
            color: var(--primary);
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .takeoff-toolbar-right button:hover {
            background: var(--primary);
            color: white;
        }
        
        /* ESTIMATE SUMMARY VIEW */
        .estimate-summary-view {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        .summary-filters {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }
        .summary-filters input,
        .summary-filters select {
            padding: 0.75rem;
            background: var(--card);
            border: 1px solid var(--line);
            color: var(--text);
            border-radius: 6px;
            font-family: Outfit;
        }
        .summary-table {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            overflow: hidden;
        }
        .summary-table table {
            width: 100%;
            border-collapse: collapse;
        }
        .summary-table th,
        .summary-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid var(--line);
        }
        .summary-table th {
            background: rgba(37, 99, 235, 0.2);
            font-weight: 700;
            color: var(--primary);
        }
        .summary-table tr:hover {
            background: rgba(37, 99, 235, 0.1);
        }
        .summary-totals {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 1.5rem;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
        }
        .total-item {
            padding: 1rem;
            background: rgba(37, 99, 235, 0.1);
            border-radius: 6px;
            border-left: 3px solid var(--primary);
        }
        .total-item-label {
            color: var(--muted);
            font-size: 0.85rem;
            margin-bottom: 0.5rem;
        }
        .total-item-value {
            font-size: 1.5rem;
            font-weight: 800;
            color: var(--primary);
        }
        
        .btn-primary-custom {
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            border: 0;
            color: white;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .btn-primary-custom:hover {
            background: #1d4ed8;
        }
        
        .list-group-item {
            background: transparent;
        }
        .list-group-item-action {
            color: var(--text);
            transition: 0.2s;
        }
        .list-group-item-action:hover {
            background: rgba(37, 99, 235, 0.2);
            color: var(--accent);
        }
    </style>
</head>
<body>
    <div class="project-header">
        <div class="project-title-section">
            <h1><?= htmlspecialchars($project['name']) ?></h1>
            <p><?= htmlspecialchars($project['description'] ?? 'No description') ?></p>
        </div>
    </div>

    <!-- PROJECT TOP NAVIGATION -->
    <div class="project-nav">
        <a href="?id=<?= $projectId ?>&tab=overview" class="<?= $activeTab === 'overview' ? 'active' : '' ?>">
            <i class="fas fa-eye"></i> Overview
        </a>
        <a href="?id=<?= $projectId ?>&tab=documents" class="<?= $activeTab === 'documents' ? 'active' : '' ?>">
            <i class="fas fa-file-alt"></i> Documents
        </a>
        <a href="?id=<?= $projectId ?>&tab=takeoff" class="<?= $activeTab === 'takeoff' ? 'active' : '' ?>">
            <i class="fas fa-ruler-combined"></i> Takeoff
        </a>
        <a href="?id=<?= $projectId ?>&tab=estimating" class="<?= $activeTab === 'estimating' ? 'active' : '' ?>">
            <i class="fas fa-calculator"></i> Estimating
        </a>
        <a href="?id=<?= $projectId ?>&tab=proposal" class="<?= $activeTab === 'proposal' ? 'active' : '' ?>">
            <i class="fas fa-file-invoice"></i> Proposal
        </a>
    </div>

    <div class="project-content">
        
        <!-- OVERVIEW TAB -->
        <?php if ($activeTab === 'overview'): ?>
            <div class="overview-section">
                <h2>Project Overview</h2>
                <div class="row mt-4">
                    <div class="col-md-6">
                        <div class="card bg-dark border-secondary">
                            <div class="card-body">
                                <h5 class="card-title">Project Details</h5>
                                <p><strong>Name:</strong> <?= htmlspecialchars($project['name']) ?></p>
                                <p><strong>Status:</strong> <span class="badge bg-info"><?= $project['status'] ?></span></p>
                                <p><strong>Client:</strong> <?= htmlspecialchars($project['client_name'] ?? 'N/A') ?></p>
                                <p><strong>Address:</strong> <?= htmlspecialchars($project['job_address'] ?? 'N/A') ?></p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-dark border-secondary">
                            <div class="card-body">
                                <h5 class="card-title">Dates</h5>
                                <p><strong>Created:</strong> <?= date('M d, Y', strtotime($project['created_at'])) ?></p>
                                <p><strong>Updated:</strong> <?= date('M d, Y', strtotime($project['updated_at'])) ?></p>
                                <p><strong>Bid Due:</strong> <?= $project['bid_due_at'] ? date('M d, Y', strtotime($project['bid_due_at'])) : 'N/A' ?></p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        <?php endif; ?>

        <!-- DOCUMENTS TAB -->
        <?php if ($activeTab === 'documents'): ?>
            <div class="documents-section">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h2>Documents</h2>
                    <button class="btn-primary-custom"><i class="fas fa-plus"></i> Upload Document</button>
                </div>
                
                <?php if (count($documents) > 0): ?>
                    <div class="summary-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Title</th>
                                    <th>Type</th>
                                    <th>File</th>
                                    <th>Size</th>
                                    <th>Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($documents as $doc): ?>
                                    <tr>
                                        <td><?= htmlspecialchars($doc['title']) ?></td>
                                        <td><span class="badge bg-secondary"><?= $doc['document_type'] ?></span></td>
                                        <td><?= htmlspecialchars($doc['original_filename']) ?></td>
                                        <td><?= isset($doc['file_size']) ? round($doc['file_size'] / 1024 / 1024, 2) . ' MB' : 'N/A' ?></td>
                                        <td><?= date('M d, Y', strtotime($doc['created_at'])) ?></td>
                                        <td>
                                            <a href="<?= $doc['storage_path'] ?>" class="btn btn-sm btn-outline-primary">Download</a>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                <?php else: ?>
                    <p class="text-muted">No documents uploaded yet.</p>
                <?php endif; ?>
            </div>
        <?php endif; ?>

        <!-- TAKEOFF TAB -->
        <?php if ($activeTab === 'takeoff'): ?>
            <div class="takeoff-section">
                <h2>Takeoff Module</h2>
                
                <!-- INTERNAL SLIDE NAVIGATION -->
                <div class="takeoff-slides-nav">
                    <a href="?id=<?= $projectId ?>&tab=takeoff&slide=drawing" 
                       class="takeoff-slide-btn <?= $takeoffSlide === 'drawing' ? 'active' : '' ?>">
                        <i class="fas fa-image"></i> Drawing Takeoff
                    </a>
                    <a href="?id=<?= $projectId ?>&tab=takeoff&slide=summary" 
                       class="takeoff-slide-btn <?= $takeoffSlide === 'summary' ? 'active' : '' ?>">
                        <i class="fas fa-table"></i> Estimate Summary
                    </a>
                </div>

                <!-- SLIDE 1: DRAWING TAKEOFF -->
                <?php if ($takeoffSlide === 'drawing'): ?>
                    <div class="drawing-view">
                        <!-- LEFT PANEL: LAYERS -->
                        <div class="takeoff-panel-left">
                            <h5>Takeoff Layers</h5>
                            <input type="text" class="form-control form-control-sm mb-3" placeholder="Search layers...">
                            <button class="btn btn-sm btn-primary w-100 mb-3"><i class="fas fa-plus"></i> Add Layer</button>
                            
                            <?php if (count($takeoffLayers) > 0): ?>
                                <div class="list-group list-group-flush">
                                    <?php foreach ($takeoffLayers as $layer): ?>
                                        <button class="list-group-item list-group-item-action bg-transparent border-secondary" style="text-align: left;">
                                            <div class="d-flex justify-content-between align-items-center">
                                                <div>
                                                    <strong><?= htmlspecialchars($layer['name']) ?></strong><br>
                                                    <small class="text-muted">Qty: <?= $layer['quantity'] ?></small>
                                                </div>
                                                <i class="fas fa-square" style="color: <?= $layer['color'] ?>"></i>
                                            </div>
                                        </button>
                                    <?php endforeach; ?>
                                </div>
                            <?php else: ?>
                                <p class="text-muted small">No layers created yet.</p>
                            <?php endif; ?>
                        </div>

                        <!-- CENTER: DRAWING CANVAS -->
                        <div class="drawing-canvas">
                            <div class="drawing-canvas-placeholder">
                                <i class="fas fa-file-pdf"></i>
                                <p>PDF Drawing Area</p>
                                <small class="text-muted">Load drawing to begin takeoff</small>
                            </div>
                        </div>

                        <!-- RIGHT TOOLBAR -->
                        <div class="takeoff-toolbar-right">
                            <h5>Tools</h5>
                            <button><i class="fas fa-save"></i> Save</button>
                            <button><i class="fas fa-search"></i> Zoom</button>
                            <button><i class="fas fa-ruler"></i> Scale</button>
                            <button><i class="fas fa-mouse"></i> Select</button>
                            <button><i class="fas fa-pen"></i> Measure</button>
                        </div>
                    </div>
                <?php endif; ?>

                <!-- SLIDE 2: ESTIMATE SUMMARY -->
                <?php if ($takeoffSlide === 'summary'): ?>
                    <div class="estimate-summary-view">
                        <!-- FILTERS -->
                        <div class="summary-filters">
                            <input type="text" placeholder="Search item..." style="flex: 1; min-width: 200px;">
                            <select style="min-width: 150px;">
                                <option value="">Filter by group...</option>
                            </select>
                            <select style="min-width: 150px;">
                                <option value="">Filter by source...</option>
                                <option value="takeoff">Takeoff</option>
                                <option value="manual">Manual</option>
                                <option value="catalog">Catalog</option>
                            </select>
                            <button class="btn-primary-custom"><i class="fas fa-plus"></i> Add Item</button>
                        </div>

                        <!-- ITEMS TABLE -->
                        <div class="summary-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th>Type</th>
                                        <th>Qty</th>
                                        <th>Unit</th>
                                        <th>Unit Cost</th>
                                        <th>Material</th>
                                        <th>Labor</th>
                                        <th>Total</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php if (count($estimateItems) > 0): ?>
                                        <?php foreach ($estimateItems as $item): ?>
                                            <tr>
                                                <td><?= htmlspecialchars($item['name']) ?></td>
                                                <td><span class="badge bg-info"><?= $item['source_type'] ?></span></td>
                                                <td><?= $item['quantity'] ?></td>
                                                <td><?= $item['unit_of_measure'] ?></td>
                                                <td>$<?= number_format($item['unit_cost'], 2) ?></td>
                                                <td>$<?= number_format($item['material_cost'], 2) ?></td>
                                                <td>$<?= number_format($item['labor_cost'], 2) ?></td>
                                                <td><strong>$<?= number_format($item['total_cost'], 2) ?></strong></td>
                                                <td>
                                                    <button class="btn btn-sm btn-outline-primary" title="Edit"><i class="fas fa-edit"></i></button>
                                                    <button class="btn btn-sm btn-outline-danger" title="Delete"><i class="fas fa-trash"></i></button>
                                                </td>
                                            </tr>
                                        <?php endforeach; ?>
                                    <?php else: ?>
                                        <tr>
                                            <td colspan="9" class="text-center text-muted">No items yet. <a href="#" class="text-primary">Create from takeoff layers</a> or <a href="#" class="text-primary">add manual item</a></td>
                                        </tr>
                                    <?php endif; ?>
                                </tbody>
                            </table>
                        </div>

                        <!-- TOTALS -->
                        <div class="summary-totals">
                            <div class="total-item">
                                <div class="total-item-label">Material Subtotal</div>
                                <div class="total-item-value">$0.00</div>
                            </div>
                            <div class="total-item">
                                <div class="total-item-label">Labor Subtotal</div>
                                <div class="total-item-value">$0.00</div>
                            </div>
                            <div class="total-item">
                                <div class="total-item-label">Equipment Subtotal</div>
                                <div class="total-item-value">$0.00</div>
                            </div>
                            <div class="total-item">
                                <div class="total-item-label">Waste Total</div>
                                <div class="total-item-value">$0.00</div>
                            </div>
                            <div class="total-item">
                                <div class="total-item-label">Markup Total</div>
                                <div class="total-item-value">$0.00</div>
                            </div>
                            <div class="total-item" style="border-left-color: var(--accent);">
                                <div class="total-item-label">Estimate Total</div>
                                <div class="total-item-value" style="color: var(--accent);">$0.00</div>
                            </div>
                        </div>
                    </div>
                <?php endif; ?>
            </div>
        <?php endif; ?>

        <!-- ESTIMATING TAB -->
        <?php if ($activeTab === 'estimating'): ?>
            <div class="estimating-section">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h2>Estimating Module</h2>
                    <button class="btn-primary-custom"><i class="fas fa-plus"></i> Create Estimate</button>
                </div>
                
                <?php if (count($estimates) > 0): ?>
                    <div class="summary-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Status</th>
                                    <th>Currency</th>
                                    <th>Subtotal</th>
                                    <th>Markup</th>
                                    <th>Total</th>
                                    <th>Labor Hours</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($estimates as $est): ?>
                                    <tr>
                                        <td><?= htmlspecialchars($est['name']) ?></td>
                                        <td><span class="badge bg-success"><?= $est['status'] ?></span></td>
                                        <td><?= $est['currency_code'] ?></td>
                                        <td>$<?= number_format($est['subtotal_cost'], 2) ?></td>
                                        <td>$<?= number_format($est['markup_total'], 2) ?></td>
                                        <td><strong>$<?= number_format($est['total_cost'], 2) ?></strong></td>
                                        <td><?= number_format($est['labor_hours_total'], 2) ?> hrs</td>
                                        <td>
                                            <a href="estimate_module.php?estimate_id=<?= $est['id'] ?>" class="btn btn-sm btn-outline-primary">Edit</a>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                <?php else: ?>
                    <p class="text-muted">No estimates created yet.</p>
                <?php endif; ?>
            </div>
        <?php endif; ?>

        <!-- PROPOSAL TAB -->
        <?php if ($activeTab === 'proposal'): ?>
            <div class="proposal-section">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h2>Proposals</h2>
                    <button class="btn-primary-custom"><i class="fas fa-plus"></i> Create Proposal</button>
                </div>
                
                <?php if (count($proposals) > 0): ?>
                    <div class="summary-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Title</th>
                                    <th>Number</th>
                                    <th>Status</th>
                                    <th>Subtotal</th>
                                    <th>Total</th>
                                    <th>Valid Until</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($proposals as $prop): ?>
                                    <tr>
                                        <td><?= htmlspecialchars($prop['title']) ?></td>
                                        <td><?= htmlspecialchars($prop['proposal_number'] ?? 'N/A') ?></td>
                                        <td><span class="badge bg-warning"><?= $prop['status'] ?></span></td>
                                        <td>$<?= number_format($prop['subtotal'], 2) ?></td>
                                        <td><strong>$<?= number_format($prop['total'], 2) ?></strong></td>
                                        <td><?= $prop['valid_until'] ? date('M d, Y', strtotime($prop['valid_until'])) : 'N/A' ?></td>
                                        <td>
                                            <button class="btn btn-sm btn-outline-primary">View</button>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                <?php else: ?>
                    <p class="text-muted">No proposals created yet.</p>
                <?php endif; ?>
            </div>
        <?php endif; ?>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
            <div class="p-3">
                <p class="text-muted small fw-bold text-uppercase ls-1 mb-3 ps-2">Blueprints Folders</p>
                
                <nav class="nav flex-column gap-1 nav-pills custom-pills">
                    
                    <?php foreach($allFolders as $folder): ?>
                        <div class="d-flex align-items-start justify-content-between folder-row gap-2">
                            <a href="?id=<?= $projectId ?>&view=files&folder_id=<?= $folder['id'] ?>" class="nav-link folder-link <?= ($currentView=='files' && $currentFolderId==$folder['id'])?'active':'' ?>" title="<?= htmlspecialchars($folder['name']) ?>">
                                <i class="fas fa-folder me-2 text-warning opacity-75"></i><span class="folder-link-text"><?= htmlspecialchars($folder['name']) ?></span>
                            </a>
                            <?php if(($_SESSION['role'] ?? '') === 'admin' && $folder['name'] !== 'Reports'): ?>
                                <div class="d-flex gap-1 folder-actions">
                                    <button class="btn btn-sm btn-outline-warning border-0" onclick="openMoveFolderModal(<?= (int)$folder['id'] ?>)" title="Move Folder"><i class="fas fa-exchange-alt"></i></button>
                                    <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteFolder(<?= (int)$folder['id'] ?>)" title="Delete Folder"><i class="fas fa-trash"></i></button>
                                </div>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </nav>
            </div>
        </aside>

        <main class="project-content flex-grow-1 p-4 overflow-auto">
            
            <?php if($currentView === 'summary'): ?>
                <h4 class="fw-bold mb-4">Project Summary</h4>
                <div class="row g-4">
                    <div class="col-md-3">
                        <div class="box-card p-4 text-center">
                            <h1 class="fw-bold text-primary mb-0"><?= $fileCount ?></h1>
                            <p class="text-gray">Total Files</p>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="box-card p-4 text-center">
                            <h1 class="fw-bold text-success mb-0"><?= count($allFolders) ?></h1>
                            <p class="text-gray">Active Folders</p>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="box-card p-4">
                            <h6 class="text-white mb-2">Last Activity</h6>
                            <p class="text-gray mb-0"><?= $lastActivity ? date('F d, Y h:i A', strtotime($lastActivity)) : 'No activity yet' ?></p>
                        </div>
                    </div>
                </div>

                <div class="mt-5">
                    <h5 class="fw-bold mb-3">Recent Uploads</h5>
                    <?php if(empty($recentFiles)): ?>
                        <div class="text-gray">No files uploaded yet.</div>
                    <?php else: ?>
                        <div class="row g-3">
                            <?php foreach($recentFiles as $rf): ?>
                                <div class="col-md-4 col-xl-3">
                                    <div class="box-card p-3 d-flex align-items-center justify-content-between recent-upload-card">
                                        <div class="me-3 recent-upload-info">
                                            <div class="fw-bold text-truncate"><?= htmlspecialchars($rf['filename']) ?></div>
                                            <div class="small text-gray"><?= date('M d, Y', strtotime($rf['uploaded_at'])) ?></div>
                                        </div>
                                        <div class="d-flex gap-2 recent-upload-actions">
                                            <a href="preview.php?id=<?= (int)$rf['id'] ?>" class="btn-icon" title="Preview"><i class="fas fa-eye"></i></a>
                                            <?php if(($_SESSION['role'] ?? '') !== 'viewer'): ?>
                                                <a href="editor.php?id=<?= (int)$rf['id'] ?>" class="btn-icon text-primary border-primary" title="Edit"><i class="fas fa-pen"></i></a>
                                            <?php endif; ?>
                                            <?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
                                                <button class="btn-icon text-danger border-danger" title="Delete" onclick="deleteFile(<?= (int)$rf['id'] ?>)"><i class="fas fa-trash"></i></button>
                                            <?php endif; ?>
                                        </div>
                                    </div>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>

            <?php elseif($currentView === 'desc'): ?>
                <h4 class="fw-bold mb-4">Description of Work</h4>
                <div class="box-card p-4">
                    <p class="text-white mb-4"><?= nl2br(htmlspecialchars($project['notes'] ?: 'No detailed description available.')) ?></p>
                    
                    <hr class="border-secondary opacity-25 my-4">
                    
                    <h6 class="fw-bold text-accent mb-3">Contact Information</h6>
                    <div class="row">
                        <div class="col-md-6">
                            <p class="small text-gray mb-1">Site Contact</p>
                            <p class="text-white"><?= htmlspecialchars($project['contact_name']) ?> <br> <?= htmlspecialchars($project['contact_phone']) ?></p>
                        </div>
                        <div class="col-md-6">
                            <p class="small text-gray mb-1">Company Contact</p>
                            <p class="text-white"><?= htmlspecialchars($project['company_name']) ?> <br> <?= htmlspecialchars($project['company_phone']) ?></p>
                        </div>
                    </div>
                </div>

            <?php elseif($currentView === 'files'): 
                // Lógica para obtener archivos de la carpeta seleccionada
                $files = [];
                $folderName = "Select a Folder";
                if($currentFolderId) {
                    $fStmt = $pdo->prepare("SELECT * FROM files WHERE folder_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC");
                    $fStmt->execute([$currentFolderId]);
                    $files = $fStmt->fetchAll(PDO::FETCH_ASSOC);
                    
                    // Buscar nombre de la carpeta actual
                    $currFolder = array_filter($allFolders, fn($f) => $f['id'] == $currentFolderId);
                    $folderName = !empty($currFolder) ? reset($currFolder)['name'] : "Unknown Folder";
                }
            ?>
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h4 class="fw-bold mb-0"><i class="fas fa-folder-open text-warning me-2"></i> <?= htmlspecialchars($folderName) ?></h4>
                    <span class="badge bg-secondary"><?= count($files) ?> files</span>
                </div>

                <?php if(empty($files)): ?>
                    <div class="text-center py-5">
                        <i class="fas fa-cloud-upload-alt fa-3x text-gray mb-3 opacity-25"></i>
                        <p class="text-gray">This folder is empty.</p>
                        <button class="btn btn-outline-primary btn-sm rounded-pill" onclick="openUploadModal()">Upload Here</button>
                    </div>
                <?php else: ?>
                    <div class="row g-3">
                        <?php foreach($files as $f): 
                             $ft = strtolower(pathinfo($f['filename'], PATHINFO_EXTENSION));
                             $icon = ($ft === 'pdf') ? 'fa-file-pdf text-danger' : 'fa-file-image text-primary';
                        ?>
                        <div class="col-md-3 col-xl-2">
                            <div class="box-card p-3 text-center h-100 file-hover">
                                <i class="fas <?= $icon ?> fa-3x mb-3"></i>
                                <h6 class="text-truncate small mb-1"><?= htmlspecialchars($f['filename']) ?></h6>
                                <small class="text-gray d-block mb-2"><?= date('M d', strtotime($f['uploaded_at'])) ?></small>
                                <div class="d-flex justify-content-center gap-2 file-actions-row">
                                    <a href="preview.php?id=<?= $f['id'] ?>" class="btn btn-sm btn-dark rounded-circle"><i class="fas fa-eye"></i></a>
                                    <a href="editor.php?id=<?= $f['id'] ?>" class="btn btn-sm btn-dark rounded-circle text-primary"><i class="fas fa-pen"></i></a>
                                    <?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
                                        <button class="btn btn-sm btn-dark rounded-circle text-warning" onclick="openMoveModal(<?= (int)$f['id'] ?>)" title="Move"><i class="fas fa-exchange-alt"></i></button>
                                        <button class="btn btn-sm btn-dark rounded-circle text-danger" onclick="deleteFile(<?= (int)$f['id'] ?>)" title="Delete"><i class="fas fa-trash"></i></button>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>

            <?php else: ?>
                <div class="text-center py-5">
                    <p class="text-gray">Module under development.</p>
                </div>
            <?php endif; ?>

        </main>
    </div>
</div>

<style>
    .project-sidebar .nav-link {
        color: var(--text-muted);
        border-radius: 8px;
        padding: 10px 15px;
        transition: 0.2s;
        font-size: 0.95rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .project-sidebar .nav-link:hover {
        background: rgba(255,255,255,0.05);
        color: white;
    }
    .project-sidebar .nav-link.active {
        background: var(--primary);
        color: white;
        font-weight: 500;
        box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
    }
    .project-layout { min-width: 0; }
    .project-sidebar { flex: 0 0 320px; min-width: 320px; transition: all .25s ease; }
    .project-content { min-width: 0; }
    .project-layout.sidebar-collapsed .project-sidebar { display: none; }

    .project-sidebar .p-3 { min-width: 0; }
    .folder-row { min-width: 0; align-items: center !important; }
    .folder-link {
        min-width: 0;
        max-width: calc(100% - 64px);
        flex: 1 1 auto;
        white-space: nowrap;
        line-height: 1.35;
        display: flex;
        align-items: center;
        overflow: hidden;
    }
    .folder-link-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
        max-width: 100%;
    }
    .folder-actions { flex: 0 0 56px; width: 56px; padding-top: 0; justify-content: flex-end; }
    .file-hover {
        position: relative;
        overflow: hidden;
        min-height: 214px;
        padding-bottom: 54px !important;
    }
    .file-actions-row {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 10px;
        min-height: 34px;
        align-items: center;
        justify-content: center;
        flex-wrap: nowrap;
        z-index: 2;
    }
    .file-actions-row .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        line-height: 1;
    }
    .file-hover:hover {
        background: rgba(255,255,255,0.05);
        transform: translateY(-2px);
    }

    @media (max-width: 992px) {
        .bg-header { flex-direction: column; align-items: flex-start; gap: 12px; }
        .bg-header .d-flex.gap-2 { width: 100%; flex-wrap: wrap; }
        .project-sidebar {
            width: 100% !important;
            min-width: 100%;
            border-right: 0;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .project-content { padding: 20px !important; }
        .project-layout { flex-direction: column; }
    }

    .recent-upload-card { gap: 12px; }
    .recent-upload-info { min-width: 0; }
    .recent-upload-actions { flex-shrink: 0; }
    @media (max-width: 768px) {
        .recent-upload-card { flex-wrap: wrap; }
        .recent-upload-actions { width: 100%; justify-content: flex-end; }
    }
</style>

<?php include __DIR__ . '/../views/modals.php'; ?>

<div class="modal fade" id="uploadFileModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Upload File</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="uploadFileForm">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Select File</label>
                    <input type="file" name="file" id="upload_file_input" class="form-control mb-3" required>

                    <label class="text-gray small mb-2">Select Folder</label>
                    <select name="folder_id" id="upload_folder_select" class="form-select text-white bg-dark border-secondary" required>
                        <option value="">Select a folder...</option>
                        <?php foreach($allFolders as $folder): ?>
                            <option value="<?= (int)$folder['id'] ?>"><?= htmlspecialchars($folder['name']) ?></option>
                        <?php endforeach; ?>
                    </select>
                    <?php if(empty($allFolders)): ?>
                        <div class="text-muted small mt-2">No folders available. Create a folder first.</div>
                    <?php endif; ?>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Upload</button>
                </div>
            </form>
        </div>
    </div>
</div>

<div id="uploadProgressWrap" class="position-fixed bottom-0 end-0 m-3" style="z-index: 2000; width: 280px; display:none;">
    <div class="box-card p-3">
        <div class="small text-gray mb-2">Uploading file...</div>
        <div class="progress" style="height:8px;">
            <div id="uploadProgressBar" class="progress-bar" role="progressbar" style="width:0%"></div>
        </div>
        <div class="small text-gray mt-2" id="uploadProgressText">0%</div>
    </div>
</div>

<?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
<div class="modal fade" id="moveFolderModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Move Folder</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="moveFolderForm">
                <input type="hidden" name="action" value="move_folder">
                <input type="hidden" name="folder_id" id="move_folder_id" value="">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Target Project</label>
                    <select name="target_project_id" id="move_folder_project_select" class="form-select text-white bg-dark border-secondary" onchange="loadFoldersForFolderMove(this.value)" required>
                        <option value="">Loading projects...</option>
                    </select>

                    <label class="text-gray small mb-2 mt-3">Move Into Folder (Optional)</label>
                    <select name="target_parent_folder_id" id="move_folder_parent_select" class="form-select text-white bg-dark border-secondary">
                        <option value="">Keep as top-level</option>
                    </select>
                    <div class="text-muted small mt-2">Select a parent folder to create a subfolder with the current name.</div>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Move Folder</button>
                </div>
            </form>
        </div>
    </div>
</div>

<div class="modal fade" id="newFolderModalDash" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Add Folder</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="newFolderFormDash">
                <div class="modal-body">
                    <div id="newFolderError" class="alert alert-danger py-2 px-3 mb-3 d-none" role="alert"></div>
                    <label class="text-gray small mb-2">Folder Name</label>
                    <input type="text" name="name" class="form-control" required maxlength="255">
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Create</button>
                </div>
            </form>
        </div>
    </div>
</div>

<div class="modal fade" id="assignUsersModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Assign Users to Project</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="assignUsersForm">
                <input type="hidden" name="action" value="assign_project_users">
                <input type="hidden" name="project_id" value="<?= (int)$projectId ?>">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Assign Users</label>
                    <div class="border rounded p-2" style="max-height:200px; overflow:auto;">
                        <?php foreach($assignUsers as $u): ?>
                            <label class="d-flex align-items-center gap-2 small text-gray mb-2">
                                <input type="checkbox" name="user_ids[]" value="<?= (int)$u['id'] ?>" data-role="<?= htmlspecialchars($u['role']) ?>" <?= in_array((int)$u['id'], $assignedUserIds, true) ? 'checked' : '' ?>>
                                <span><?= htmlspecialchars($u['username']) ?> (<?= htmlspecialchars($u['role']) ?>)</span>
                            </label>
                        <?php endforeach; ?>
                        <?php if(empty($assignUsers)): ?>
                            <div class="text-gray small">No users available.</div>
                        <?php endif; ?>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Assign Selected Users</button>
                </div>
            </form>
        </div>
    </div>
</div>
<?php endif; ?>

<input type="file" id="projectUploadInput" class="d-none">

<script>
    const pId = <?= $projectId ?>;
    const fId = <?= $currentFolderId ?? 'null' ?>;

    function applyProjectSidebarState(collapsed) {
        const layout = document.getElementById('projectLayout');
        const text = document.getElementById('toggleProjectSidebarText');
        if (!layout) return;
        layout.classList.toggle('sidebar-collapsed', collapsed);
        if (text) text.textContent = collapsed ? 'Show Menu' : 'Hide Menu';
    }

    function toggleProjectSidebar() {
        const layout = document.getElementById('projectLayout');
        if (!layout) return;
        const collapsed = !layout.classList.contains('sidebar-collapsed');
        applyProjectSidebarState(collapsed);
        try { localStorage.setItem('projectSidebarCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    }

    document.addEventListener('DOMContentLoaded', function() {
        let collapsed = false;
        try { collapsed = localStorage.getItem('projectSidebarCollapsed') === '1'; } catch (e) {}
        applyProjectSidebarState(collapsed);
    });

    function openUploadModal() {
        if (fId) {
            const input = document.getElementById('projectUploadInput');
            if (input) input.click();
            return;
        }
        const modalEl = document.getElementById('uploadFileModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();
    }

    const projectUploadInput = document.getElementById('projectUploadInput');
    if (projectUploadInput) {
        projectUploadInput.addEventListener('change', function() {
            if (!this.files || this.files.length === 0) return;
            if (!fId) return;
            const fd = new FormData();
            fd.append('action', 'upload_file');
            fd.append('project_id', pId);
            if (fId) fd.append('folder_id', fId);
            fd.append('file', this.files[0]);
            fetch('../api/api.php', { method:'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if (d.status === 'success') location.reload();
                    else alert('Error uploading file: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function showUploadProgress() {
        const wrap = document.getElementById('uploadProgressWrap');
        const bar = document.getElementById('uploadProgressBar');
        const txt = document.getElementById('uploadProgressText');
        if (!wrap || !bar || !txt) return;
        wrap.style.display = 'block';
        bar.style.width = '0%';
        txt.textContent = '0%';
    }

    function updateUploadProgress(pct) {
        const bar = document.getElementById('uploadProgressBar');
        const txt = document.getElementById('uploadProgressText');
        if (!bar || !txt) return;
        const clamped = Math.max(0, Math.min(100, Math.round(pct)));
        bar.style.width = clamped + '%';
        txt.textContent = clamped + '%';
    }

    function hideUploadProgress(delay = 1200) {
        const wrap = document.getElementById('uploadProgressWrap');
        if (!wrap) return;
        setTimeout(() => { wrap.style.display = 'none'; }, delay);
    }

    function uploadWithProgress(fd) {
        showUploadProgress();
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '../api/api.php', true);
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    updateUploadProgress((e.loaded / e.total) * 100);
                }
            });
            xhr.addEventListener('load', () => {
                updateUploadProgress(100);
                try {
                    const res = JSON.parse(xhr.responseText);
                    resolve(res);
                } catch (err) {
                    reject(err);
                }
            });
            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            xhr.send(fd);
        });
    }

    const uploadFileForm = document.getElementById('uploadFileForm');
    if (uploadFileForm) {
        uploadFileForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const fileInput = document.getElementById('upload_file_input');
            const folderSelect = document.getElementById('upload_folder_select');
            if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                alert('Please select a file.');
                return;
            }
            if (!folderSelect || !folderSelect.value) {
                alert('Please select a folder.');
                return;
            }
            const fd = new FormData();
            fd.append('action', 'upload_file');
            fd.append('project_id', pId);
            fd.append('folder_id', folderSelect.value);
            fd.append('file', fileInput.files[0]);
            const modalEl = document.getElementById('uploadFileModal');
            if (modalEl) {
                const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                inst.hide();
            }
            uploadWithProgress(fd)
                .then(d => {
                    if (d.status === 'success') {
                        hideUploadProgress(800);
                        location.reload();
                    } else {
                        hideUploadProgress(1500);
                        alert('Error uploading file: ' + (d.msg || 'Unknown'));
                    }
                })
                .catch(() => {
                    hideUploadProgress(1500);
                    alert('Upload failed. The file may still finish uploading in the background.');
                });
        });
    }


    function openAssignUsersModal() {
        const modalEl = document.getElementById('assignUsersModal');
        if (!modalEl) return;
        new bootstrap.Modal(modalEl).show();
    }
    const assignUsersForm = document.getElementById('assignUsersForm');
    if (assignUsersForm) {
        assignUsersForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const checked = Array.from(this.querySelectorAll('input[name="user_ids[]"]:checked'));
            const hasAdmin = checked.some(i => i.dataset.role === 'admin');
            if (checked.length === 0 || !hasAdmin) {
                alert('At least one admin must be assigned to the project.');
                return;
            }
            const fd = new FormData(this);
            fetch('../api/api.php', { method:'POST', body:fd })
                .then(r => r.json())
                .then(d => {
                    if (d.status === 'success') location.reload();
                    else alert('Error assigning users: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function deleteFile(id) {
        if(!confirm("Move file to Recycle Bin?")) return;
        const fd = new FormData();
        fd.append('action', 'delete_entity');
        fd.append('type', 'file');
        fd.append('id', id);
        fetch('../api/api.php', { method:'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if(d.status === 'success') location.reload();
                else alert('Error deleting file: ' + (d.msg || 'Unknown'));
            })
            .catch(() => alert('Connection error'));
    }

    function deleteFolder(id) {
        if(!confirm("Move folder to Recycle Bin?")) return;
        const fd = new FormData();
        fd.append('action', 'delete_entity');
        fd.append('type', 'folder');
        fd.append('id', id);
        fetch('../api/api.php', { method:'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if(d.status === 'success') location.reload();
                else alert('Error deleting folder: ' + (d.msg || 'Unknown'));
            })
            .catch(() => alert('Connection error'));
    }

    function openMoveModal(fileId) {
        const moveId = document.getElementById('move_id');
        const moveType = document.getElementById('move_type');
        const projSelect = document.getElementById('move_project_select');
        const folderSelect = document.getElementById('move_folder_select');
        if (!moveId || !moveType || !projSelect || !folderSelect) return;

        moveId.value = fileId;
        moveType.value = 'file';
        projSelect.innerHTML = '<option value="">Loading projects...</option>';
        folderSelect.innerHTML = '<option value="">Root Folder</option>';

        const modalEl = document.getElementById('moveFileModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();

        const fd = new FormData();
        fd.append('action', 'get_projects_list');
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if(res.status === 'success') {
                    projSelect.innerHTML = '<option value="">Select Target Project...</option>';
                    res.data.forEach(p => { projSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
                } else {
                    projSelect.innerHTML = '<option value="">Error loading</option>';
                }
            })
            .catch(() => { projSelect.innerHTML = '<option value="">Connection Error</option>'; });
    }

    function loadFoldersForMove(projId) {
        const folderSel = document.getElementById('move_folder_select');
        if (!folderSel) return;
        folderSel.innerHTML = '<option value="">Loading...</option>';
        if(!projId) { folderSel.innerHTML = '<option value="">Root Folder</option>'; return; }

        const fd = new FormData();
        fd.append('action', 'get_folders_list');
        fd.append('project_id', projId);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                folderSel.innerHTML = '<option value="">Root Folder (No specific folder)</option>';
                if(res.status === 'success') {
                    res.data.forEach(f => { folderSel.innerHTML += `<option value="${f.id}">${f.name}</option>`; });
                }
            })
            .catch(() => { folderSel.innerHTML = '<option value="">Connection Error</option>'; });
    }

    const moveForm = document.getElementById('moveFileForm');
    if (moveForm) {
        moveForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const fd = new FormData(this);
            fetch('../api/api.php', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if(d.status === 'success') location.reload();
                    else alert('Error moving file: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function openMoveFolderModal(folderId) {
        const moveFolderId = document.getElementById('move_folder_id');
        const projSelect = document.getElementById('move_folder_project_select');
        const parentSelect = document.getElementById('move_folder_parent_select');
        if (!moveFolderId || !projSelect || !parentSelect) return;

        moveFolderId.value = folderId;
        projSelect.innerHTML = '<option value="">Loading projects...</option>';
        parentSelect.innerHTML = '<option value="">Keep as top-level</option>';

        const modalEl = document.getElementById('moveFolderModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();

        const fd = new FormData();
        fd.append('action', 'get_projects_list');
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if(res.status === 'success') {
                    projSelect.innerHTML = '<option value="">Select Target Project...</option>';
                    res.data.forEach(p => { projSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
                } else {
                    projSelect.innerHTML = '<option value="">Error loading</option>';
                }
            })
            .catch(() => { projSelect.innerHTML = '<option value="">Connection Error</option>'; });
    }

    function loadFoldersForFolderMove(projId) {
        const parentSel = document.getElementById('move_folder_parent_select');
        if (!parentSel) return;
        parentSel.innerHTML = '<option value="">Loading...</option>';
        if(!projId) { parentSel.innerHTML = '<option value="">Keep as top-level</option>'; return; }

        const currentFolderId = parseInt(document.getElementById('move_folder_id').value || '0', 10);
        const fd = new FormData();
        fd.append('action', 'get_folders_list');
        fd.append('project_id', projId);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                parentSel.innerHTML = '<option value="">Keep as top-level</option>';
                if(res.status === 'success') {
                    res.data.forEach(f => {
                        if (parseInt(f.id, 10) === currentFolderId) return;
                        parentSel.innerHTML += `<option value="${f.id}">${f.name}</option>`;
                    });
                }
            })
            .catch(() => { parentSel.innerHTML = '<option value="">Connection Error</option>'; });
    }

    const moveFolderForm = document.getElementById('moveFolderForm');
    if (moveFolderForm) {
        moveFolderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const fd = new FormData(this);
            fetch('../api/api.php', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if(d.status === 'success') location.reload();
                    else alert('Error moving folder: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function openNewFolderModal() {
        const modalEl = document.getElementById('newFolderModalDash');
        if (!modalEl) return;
        if (typeof clearNewFolderError === 'function') clearNewFolderError();
        new bootstrap.Modal(modalEl).show();
    }
    const newFolderFormDash = document.getElementById('newFolderFormDash');
    const newFolderError = document.getElementById('newFolderError');
    const showNewFolderError = (msg) => {
        if (!newFolderError) return;
        newFolderError.textContent = msg;
        newFolderError.classList.remove('d-none');
    };
    const clearNewFolderError = () => {
        if (!newFolderError) return;
        newFolderError.textContent = '';
        newFolderError.classList.add('d-none');
    };

    if (newFolderFormDash) {
        newFolderFormDash.addEventListener('submit', function(e) {
            e.preventDefault();
            clearNewFolderError();
            const fd = new FormData(this);
            fd.append('action', 'create_folder');
            fd.append('project_id', pId);
            fetch('../api/api.php', { method:'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if (d.status === 'success') {
                        location.reload();
                    } else {
                        showNewFolderError('Error creating folder: ' + (d.msg || 'Unknown'));
                    }
                })
                .catch(() => showNewFolderError('Connection error while creating folder.'));
        });
    }
</script>

<?php include __DIR__ . '/../views/footer.php'; ?>
