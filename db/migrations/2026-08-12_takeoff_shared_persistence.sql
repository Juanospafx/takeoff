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
