-- Takeoff / Quantity Takeoff schema for MySQL 8+, InnoDB, utf8mb4.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    notes TEXT NULL,
    address VARCHAR(255) NULL,
    contact_name VARCHAR(191) NULL,
    contact_phone VARCHAR(100) NULL,
    company_name VARCHAR(191) NULL,
    company_phone VARCHAR(100) NULL,
    company_address VARCHAR(255) NULL,
    date_bid_sent DATE NULL,
    date_bid_awarded DATE NULL,
    date_started DATE NULL,
    date_finished DATE NULL,
    date_warranty_end DATE NULL,
    created_by BIGINT UNSIGNED NULL,
    assigned_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_projects_deleted (deleted_at),
    KEY idx_projects_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS folders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_folders_project (project_id),
    KEY idx_folders_deleted (deleted_at),
    CONSTRAINT fk_folders_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sub_folders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    folder_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_sub_folders_folder (folder_id),
    CONSTRAINT fk_sub_folders_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NULL,
    folder_id BIGINT UNSIGNED NULL,
    sub_folder_id BIGINT UNSIGNED NULL,
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(1024) NOT NULL,
    file_type VARCHAR(100) NULL,
    uploaded_by BIGINT UNSIGNED NULL,
    version_group_id VARCHAR(100) NULL,
    version_number INT UNSIGNED NOT NULL DEFAULT 1,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_files_project (project_id),
    KEY idx_files_folder (folder_id),
    KEY idx_files_sub_folder (sub_folder_id),
    KEY idx_files_deleted (deleted_at),
    KEY idx_files_uploaded (uploaded_at),
    CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
    CONSTRAINT fk_files_sub_folder FOREIGN KEY (sub_folder_id) REFERENCES sub_folders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    file_id BIGINT UNSIGNED NOT NULL,
    technician_name VARCHAR(191) NULL,
    technician_role VARCHAR(191) NULL,
    description TEXT NULL,
    report_pdf_path VARCHAR(1024) NULL,
    annotations_json JSON NULL,
    attachments_json JSON NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_file_reports_file (file_id),
    KEY idx_file_reports_deleted (is_deleted),
    CONSTRAINT fk_file_reports_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalogs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    catalog_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    PRIMARY KEY (id),
    KEY idx_catalog_categories_catalog (catalog_id),
    CONSTRAINT fk_catalog_categories_catalog FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    catalog_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NULL,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    sku VARCHAR(100) NULL,
    item_type ENUM('Part','Assembly','Labor','Equipment','Subcontractor','Travel','Custom') NOT NULL DEFAULT 'Part',
    cost_type VARCHAR(100) NULL,
    unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
    unit_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    material_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    labor_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    equipment_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    subcontractor_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    labor_hours DECIMAL(14,4) NOT NULL DEFAULT 0,
    labor_rate DECIMAL(14,4) NOT NULL DEFAULT 0,
    markup DECIMAL(8,4) NOT NULL DEFAULT 0,
    waste_factor DECIMAL(8,4) NOT NULL DEFAULT 0,
    size VARCHAR(100) NULL,
    diameter VARCHAR(100) NULL,
    trade_size VARCHAR(100) NULL,
    thickness VARCHAR(100) NULL,
    gauge VARCHAR(100) NULL,
    material VARCHAR(100) NULL,
    color VARCHAR(50) NULL,
    symbol VARCHAR(50) NULL,
    cost_code VARCHAR(100) NULL,
    masterformat VARCHAR(100) NULL,
    uniformat VARCHAR(100) NULL,
    attachment_url VARCHAR(1024) NULL,
    tags JSON NULL,
    attributes_json JSON NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_catalog_items_catalog (catalog_id),
    KEY idx_catalog_items_category (category_id),
    KEY idx_catalog_items_type (item_type),
    KEY idx_catalog_items_sku (sku),
    CONSTRAINT fk_catalog_items_catalog FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE,
    CONSTRAINT fk_catalog_items_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_item_attributes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    catalog_item_id BIGINT UNSIGNED NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_value TEXT NULL,
    PRIMARY KEY (id),
    KEY idx_catalog_item_attributes_item (catalog_item_id),
    KEY idx_catalog_item_attributes_name (attribute_name),
    CONSTRAINT fk_catalog_item_attributes_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assemblies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
    calculated_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    calculated_labor_hours DECIMAL(14,4) NOT NULL DEFAULT 0,
    override_cost DECIMAL(14,4) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assembly_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    assembly_id BIGINT UNSIGNED NOT NULL,
    catalog_item_id BIGINT UNSIGNED NOT NULL,
    quantity DECIMAL(14,4) NOT NULL DEFAULT 1,
    ratio_type ENUM('fixed','per_unit','per_linear_length','per_area','per_endpoint','spacing_based') NOT NULL DEFAULT 'per_unit',
    spacing_value DECIMAL(14,4) NULL,
    waste_factor DECIMAL(8,4) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    PRIMARY KEY (id),
    KEY idx_assembly_items_assembly (assembly_id),
    KEY idx_assembly_items_catalog_item (catalog_item_id),
    CONSTRAINT fk_assembly_items_assembly FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE CASCADE,
    CONSTRAINT fk_assembly_items_catalog_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drawing_scales (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    drawing_id BIGINT UNSIGNED NOT NULL,
    scale_name VARCHAR(100) NOT NULL,
    ratio DECIMAL(18,8) NOT NULL,
    unit VARCHAR(50) NOT NULL DEFAULT 'ft',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_drawing_scales_drawing (drawing_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_layers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    drawing_id BIGINT UNSIGNED NOT NULL,
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    name VARCHAR(191) NOT NULL,
    type ENUM('count','linear','area','mixed') NOT NULL DEFAULT 'mixed',
    catalog_item_id BIGINT UNSIGNED NULL,
    assembly_id BIGINT UNSIGNED NULL,
    color VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    symbol VARCHAR(50) NOT NULL DEFAULT 'circle',
    visible TINYINT(1) NOT NULL DEFAULT 1,
    locked TINYINT(1) NOT NULL DEFAULT 0,
    tag VARCHAR(100) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_takeoff_layers_drawing_page (drawing_id, page_number),
    KEY idx_takeoff_layers_item (catalog_item_id),
    KEY idx_takeoff_layers_assembly (assembly_id),
    CONSTRAINT fk_takeoff_layers_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_takeoff_layers_assembly FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_count_markers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_uid VARCHAR(64) NULL,
    layer_id BIGINT UNSIGNED NOT NULL,
    catalog_item_id BIGINT UNSIGNED NULL,
    assembly_id BIGINT UNSIGNED NULL,
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    x DECIMAL(18,6) NOT NULL,
    y DECIMAL(18,6) NOT NULL,
    symbol VARCHAR(50) NOT NULL DEFAULT 'circle',
    color VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    label VARCHAR(191) NULL,
    multiplier DECIMAL(14,4) NOT NULL DEFAULT 1,
    quantity DECIMAL(14,4) NOT NULL DEFAULT 1,
    notes TEXT NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_takeoff_count_layer (layer_id),
    CONSTRAINT fk_takeoff_count_layer FOREIGN KEY (layer_id) REFERENCES takeoff_layers(id) ON DELETE CASCADE,
    CONSTRAINT fk_takeoff_count_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_takeoff_count_assembly FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_linear_segments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_uid VARCHAR(64) NULL,
    layer_id BIGINT UNSIGNED NOT NULL,
    catalog_item_id BIGINT UNSIGNED NULL,
    assembly_id BIGINT UNSIGNED NULL,
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    points_json JSON NOT NULL,
    measured_length DECIMAL(18,6) NOT NULL DEFAULT 0,
    multiplier DECIMAL(14,4) NOT NULL DEFAULT 1,
    total_length DECIMAL(18,6) NOT NULL DEFAULT 0,
    unit VARCHAR(50) NOT NULL DEFAULT 'ft',
    color VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    stroke_width DECIMAL(8,2) NOT NULL DEFAULT 4,
    label VARCHAR(191) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_takeoff_linear_layer (layer_id),
    CONSTRAINT fk_takeoff_linear_layer FOREIGN KEY (layer_id) REFERENCES takeoff_layers(id) ON DELETE CASCADE,
    CONSTRAINT fk_takeoff_linear_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_takeoff_linear_assembly FOREIGN KEY (assembly_id) REFERENCES assemblies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_tags (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(50) NOT NULL DEFAULT '#64748b',
    PRIMARY KEY (id),
    UNIQUE KEY uq_takeoff_tags_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_measurement_summaries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    drawing_id BIGINT UNSIGNED NOT NULL,
    summary_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_takeoff_summaries_drawing_created (drawing_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO catalogs (id, name, description) VALUES
    (1, 'Electrical Takeoff Catalog', 'Default material and labor catalog for electrical takeoff')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO catalog_categories (id, catalog_id, name, description) VALUES
    (1, 1, 'Conduit', 'Raceways and conduit'),
    (2, 1, 'Wire', 'Conductors and cable'),
    (3, 1, 'Devices', 'Electrical devices and fixtures'),
    (4, 1, 'Labor', 'Labor line items')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO catalog_items
    (id, catalog_id, category_id, name, sku, item_type, cost_type, unit_of_measure, unit_cost, material_cost, labor_cost, labor_hours, labor_rate, markup, waste_factor, size, trade_size, material, color, symbol, cost_code, attributes_json)
VALUES
    (1, 1, 1, 'EMT Conduit 1/2 inch', 'EMT-050', 'Part', 'material', 'ft', 0.85, 0.85, 0.20, 0.0100, 85.00, 10.00, 5.00, '1/2"', '1/2"', 'Steel', '#2563eb', 'circle', '26-05-33', JSON_OBJECT('conduit_type','EMT')),
    (2, 1, 2, 'Copper THHN 600 KCMIL', 'CU-600-THHN', 'Part', 'material', 'ft', 8.75, 8.75, 0.45, 0.0150, 85.00, 10.00, 3.00, '600 KCMIL', '600 KCMIL', 'Copper', '#dc2626', 'square', '26-05-19', JSON_OBJECT('wire_size','600 KCMIL','insulation','THHN','voltage','600V')),
    (3, 1, 3, 'Duplex Receptacle', 'REC-DUP-20A', 'Part', 'material', 'ea', 4.50, 4.50, 12.75, 0.1500, 85.00, 10.00, 2.00, '20A', '20A', 'Nylon', '#16a34a', 'diamond', '26-27-26', JSON_OBJECT('rating','20A','voltage','125V')),
    (4, 1, 4, 'Electrician Labor', 'LAB-ELEC', 'Labor', 'labor', 'hr', 85.00, 0.00, 85.00, 1.0000, 85.00, 0.00, 0.00, NULL, NULL, NULL, '#f59e0b', 'cross', '26-00-00', JSON_OBJECT('crew','Electrician'))
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO assemblies (id, name, description, unit_of_measure, calculated_cost, calculated_labor_hours, active)
VALUES (1, 'EMT 1/2 inch + 600 KCMIL cable run', 'Linear assembly for conduit with cable and labor', 'ft', 0, 0, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO assembly_items (id, assembly_id, catalog_item_id, quantity, ratio_type, spacing_value, waste_factor, notes) VALUES
    (1, 1, 1, 1.0000, 'per_linear_length', NULL, 5.0000, 'One foot of EMT per measured foot'),
    (2, 1, 2, 1.0000, 'per_linear_length', NULL, 3.0000, 'One foot of conductor per measured foot'),
    (3, 1, 4, 0.0200, 'per_linear_length', NULL, 0.0000, 'Labor hours per measured foot')
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), ratio_type = VALUES(ratio_type);

INSERT INTO takeoff_tags (name, color) VALUES
    ('Electrical', '#2563eb'),
    ('Review', '#f59e0b'),
    ('Change order', '#dc2626')
ON DUPLICATE KEY UPDATE color = VALUES(color);
