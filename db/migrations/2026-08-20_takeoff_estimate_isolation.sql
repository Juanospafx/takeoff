-- Independent Takeoff workspaces per estimate and drawing.
ALTER TABLE takeoff_layers
    ADD COLUMN IF NOT EXISTS estimate_key VARCHAR(191) NULL,
    ADD INDEX IF NOT EXISTS idx_takeoff_layers_estimate_drawing (estimate_key, drawing_id);

CREATE TABLE IF NOT EXISTS takeoff_estimate_states (
    estimate_key VARCHAR(191) NOT NULL,
    drawing_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    state_json JSON NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (estimate_key, drawing_id),
    KEY idx_takeoff_estimate_states_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS takeoff_estimate_scales (
    estimate_key VARCHAR(191) NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    drawing_id BIGINT UNSIGNED NOT NULL,
    page_number INT UNSIGNED NOT NULL DEFAULT 1,
    scale_name VARCHAR(100) NOT NULL,
    pixels_per_unit DECIMAL(18,8) NOT NULL,
    unit VARCHAR(50) NOT NULL DEFAULT 'ft',
    calibration_json JSON NULL,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (estimate_key, drawing_id, page_number),
    KEY idx_takeoff_estimate_scales_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
