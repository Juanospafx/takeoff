-- Repairs legacy Estimating schemas created by older Takeoff endpoints.
-- Safe to run repeatedly; existing columns and data are preserved.
-- Run with a migration/admin account that has ALTER and CREATE ROUTINE.
-- The runtime GET endpoint is intentionally read-only and does not require
-- either privilege after this migration has been deployed.

-- Bootstrap installations that never ran the 2026-07-31 integration migration.
-- Foreign keys are intentionally left to the canonical integration migration:
-- legacy installations can differ in signedness, while this table must become
-- usable before those constraints are reconciled.
CREATE TABLE IF NOT EXISTS estimate_workspace_states (
    estimate_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    client_estimate_id VARCHAR(191) NULL,
    state_json JSON NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (estimate_id),
    KEY idx_estimate_workspace_project (project_id),
    KEY idx_estimate_workspace_client (client_estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
DROP PROCEDURE IF EXISTS estimating_add_column_if_missing$$
CREATE PROCEDURE estimating_add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
    ) THEN
        SET @estimating_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE estimating_stmt FROM @estimating_sql;
        EXECUTE estimating_stmt;
        DEALLOCATE PREPARE estimating_stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS estimating_add_lookup_index_if_missing$$
CREATE PROCEDURE estimating_add_lookup_index_if_missing(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_column VARCHAR(64))
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column AND SEQ_IN_INDEX = 1
    ) THEN
        SET @estimating_sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (`', p_column, '`)');
        PREPARE estimating_stmt FROM @estimating_sql;
        EXECUTE estimating_stmt;
        DEALLOCATE PREPARE estimating_stmt;
    END IF;
END$$

DELIMITER ;

CALL estimating_add_column_if_missing('estimates', 'settings_json', 'JSON NULL');
CALL estimating_add_column_if_missing('estimates', 'notes_json', 'JSON NULL');
CALL estimating_add_column_if_missing('estimates', 'metadata_json', 'JSON NULL');
CALL estimating_add_column_if_missing('estimates', 'markup_total', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimates', 'tax_total', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimates', 'labor_hours_total', 'DECIMAL(18,4) NOT NULL DEFAULT 0');

CALL estimating_add_column_if_missing('estimate_items', 'takeoff_layer_id', 'BIGINT UNSIGNED NULL');
CALL estimating_add_column_if_missing('estimate_items', 'catalog_item_id', 'BIGINT UNSIGNED NULL');
CALL estimating_add_column_if_missing('estimate_items', 'source_layer_key', 'VARCHAR(191) NULL');
CALL estimating_add_column_if_missing('estimate_items', 'source_type', 'VARCHAR(50) NOT NULL DEFAULT ''manual''');
CALL estimating_add_column_if_missing('estimate_items', 'is_manual', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL estimating_add_column_if_missing('estimate_items', 'is_quantity_locked_from_takeoff', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'item_type', 'VARCHAR(50) NOT NULL DEFAULT ''line_item''');
CALL estimating_add_column_if_missing('estimate_items', 'group_name', 'VARCHAR(191) NULL');
CALL estimating_add_column_if_missing('estimate_items', 'budget_code', 'VARCHAR(100) NULL');
CALL estimating_add_column_if_missing('estimate_items', 'cost_type', 'VARCHAR(100) NULL');
CALL estimating_add_column_if_missing('estimate_items', 'description', 'TEXT NULL');
CALL estimating_add_column_if_missing('estimate_items', 'unit_labor_time', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'labor_hours', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'material_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'labor_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'equipment_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'waste_percentage', 'DECIMAL(9,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'margin_percentage', 'DECIMAL(9,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'taxable', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL estimating_add_column_if_missing('estimate_items', 'subtotal_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'total_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'sort_order', 'INT NOT NULL DEFAULT 0');
CALL estimating_add_column_if_missing('estimate_items', 'metadata_json', 'JSON NULL');

CALL estimating_add_column_if_missing('estimate_markups', 'metadata_json', 'JSON NULL');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'estimate_id', 'BIGINT UNSIGNED NULL');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'project_id', 'BIGINT UNSIGNED NULL');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'client_estimate_id', 'VARCHAR(191) NULL');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'state_json', 'JSON NULL');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 1');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
CALL estimating_add_column_if_missing('estimate_workspace_states', 'created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL estimating_add_lookup_index_if_missing('estimate_workspace_states', 'idx_estimate_workspace_estimate', 'estimate_id');

UPDATE estimate_workspace_states ws
INNER JOIN estimates e ON e.id = ws.estimate_id
SET ws.project_id = e.project_id
WHERE ws.project_id IS NULL;

UPDATE estimate_workspace_states
SET client_estimate_id = CONCAT('db-estimate-', estimate_id)
WHERE client_estimate_id IS NULL OR client_estimate_id = '';

DROP PROCEDURE IF EXISTS estimating_add_column_if_missing;
DROP PROCEDURE IF EXISTS estimating_add_lookup_index_if_missing;
