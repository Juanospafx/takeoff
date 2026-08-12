-- Shared Takeoff persistence for per-sheet calibration.
-- Geometry already lives in takeoff_layers, takeoff_count_markers and
-- takeoff_linear_segments. This table replaces browser-only scale storage.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS takeoff_sheet_scales (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NULL,
    drawing_id BIGINT UNSIGNED NOT NULL COMMENT 'files.id used by editor.php',
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    scale_name VARCHAR(100) NOT NULL,
    pixels_per_unit DECIMAL(18,8) NOT NULL,
    unit VARCHAR(50) NOT NULL DEFAULT 'ft',
    calibration_json JSON NULL,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_takeoff_sheet_scale (drawing_id, page_number),
    KEY idx_takeoff_sheet_scales_project (project_id),
    CONSTRAINT fk_takeoff_sheet_scales_file
        FOREIGN KEY (drawing_id) REFERENCES files(id) ON DELETE CASCADE,
    CONSTRAINT fk_takeoff_sheet_scales_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Concrete geometry tables consumed by api/takeoff.php. Earlier schemas
-- declared the generic takeoff_measurements table, while the editor API used
-- these specialized tables without ever creating them.
CREATE TABLE IF NOT EXISTS takeoff_count_markers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_uid VARCHAR(191) NULL,
    layer_id BIGINT UNSIGNED NOT NULL,
    catalog_item_id BIGINT UNSIGNED NULL,
    assembly_id BIGINT UNSIGNED NULL,
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    x DECIMAL(18,6) NOT NULL DEFAULT 0,
    y DECIMAL(18,6) NOT NULL DEFAULT 0,
    symbol VARCHAR(50) NOT NULL DEFAULT 'circle',
    color VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    label VARCHAR(191) NULL,
    multiplier DECIMAL(18,6) NOT NULL DEFAULT 1,
    quantity DECIMAL(18,6) NOT NULL DEFAULT 1,
    notes TEXT NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_takeoff_count_marker_uid (layer_id, client_uid),
    KEY idx_takeoff_count_marker_page (layer_id, page_number),
    CONSTRAINT fk_takeoff_count_marker_layer FOREIGN KEY (layer_id) REFERENCES takeoff_layers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_linear_segments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_uid VARCHAR(191) NULL,
    layer_id BIGINT UNSIGNED NOT NULL,
    catalog_item_id BIGINT UNSIGNED NULL,
    assembly_id BIGINT UNSIGNED NULL,
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    points_json JSON NOT NULL,
    measured_length DECIMAL(18,6) NOT NULL DEFAULT 0,
    multiplier DECIMAL(18,6) NOT NULL DEFAULT 1,
    total_length DECIMAL(18,6) NOT NULL DEFAULT 0,
    unit VARCHAR(50) NOT NULL DEFAULT 'ft',
    color VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    stroke_width DECIMAL(10,4) NOT NULL DEFAULT 4,
    label VARCHAR(191) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_takeoff_linear_segment_uid (layer_id, client_uid),
    KEY idx_takeoff_linear_segment_page (layer_id, page_number),
    CONSTRAINT fk_takeoff_linear_segment_layer FOREIGN KEY (layer_id) REFERENCES takeoff_layers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_measurement_summaries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    drawing_id BIGINT UNSIGNED NOT NULL,
    summary_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_takeoff_summary_drawing_created (drawing_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
