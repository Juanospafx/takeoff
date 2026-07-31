-- Consolidate Takeoff <-> Estimating persistence.
-- MySQL 8+, idempotent, additive, and safe for existing records.
-- Run after 2026-06-11_takeoff_base_tables.sql and the main schema/estimate tables.

SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS migration_add_column_if_missing$$
CREATE PROCEDURE migration_add_column_if_missing(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = p_table
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
    ) THEN
        SET @migration_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE migration_stmt FROM @migration_sql;
        EXECUTE migration_stmt;
        DEALLOCATE PREPARE migration_stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS migration_add_index_if_missing$$
CREATE PROCEDURE migration_add_index_if_missing(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = p_table
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = p_table AND index_name = p_index
    ) THEN
        SET @migration_sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
        PREPARE migration_stmt FROM @migration_sql;
        EXECUTE migration_stmt;
        DEALLOCATE PREPARE migration_stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS migration_add_fk_if_missing$$
CREATE PROCEDURE migration_add_fk_if_missing(
    IN p_table VARCHAR(64),
    IN p_constraint VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = p_table
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = DATABASE()
          AND table_name = p_table
          AND constraint_name = p_constraint
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        SET @migration_sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_constraint, '` ', p_definition);
        PREPARE migration_stmt FROM @migration_sql;
        EXECUTE migration_stmt;
        DEALLOCATE PREPARE migration_stmt;
    END IF;
END$$

-- Estimate-level settings and notes previously held only in browser state.
CALL migration_add_column_if_missing('estimates', 'description', 'TEXT NULL AFTER `name`')$$
CALL migration_add_column_if_missing('estimates', 'settings_json', 'JSON NULL AFTER `currency_code`')$$
CALL migration_add_column_if_missing('estimates', 'notes_json', 'JSON NULL AFTER `settings_json`')$$
CALL migration_add_column_if_missing('estimates', 'metadata_json', 'JSON NULL')$$
CALL migration_add_column_if_missing('estimates', 'markup_total', 'DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `subtotal_cost`')$$
CALL migration_add_column_if_missing('estimates', 'tax_total', 'DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `markup_total`')$$
CALL migration_add_column_if_missing('estimates', 'labor_hours_total', 'DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `total_cost`')$$

-- A stable client-generated key lets imported/local layers retain identity even when
-- their numeric database id changes between environments.
CALL migration_add_column_if_missing('takeoff_layers', 'integration_key', 'VARCHAR(191) NULL AFTER `id`')$$
CALL migration_add_column_if_missing('estimate_items', 'source_layer_key', 'VARCHAR(191) NULL AFTER `takeoff_layer_id`')$$
CALL migration_add_column_if_missing('estimate_items', 'source_type', 'VARCHAR(50) NOT NULL DEFAULT ''manual''')$$
CALL migration_add_column_if_missing('estimate_items', 'is_manual', 'TINYINT(1) NOT NULL DEFAULT 1')$$
CALL migration_add_column_if_missing('estimate_items', 'is_quantity_locked_from_takeoff', 'TINYINT(1) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'group_name', 'VARCHAR(191) NULL')$$
CALL migration_add_column_if_missing('estimate_items', 'budget_code', 'VARCHAR(100) NULL')$$
CALL migration_add_column_if_missing('estimate_items', 'cost_type', 'VARCHAR(100) NULL')$$
CALL migration_add_column_if_missing('estimate_items', 'unit_labor_time', 'DECIMAL(18,4) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'material_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'labor_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'waste_percentage', 'DECIMAL(9,4) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'margin_percentage', 'DECIMAL(9,4) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'taxable', 'TINYINT(1) NOT NULL DEFAULT 1')$$
CALL migration_add_column_if_missing('estimate_items', 'subtotal_cost', 'DECIMAL(18,4) NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'sort_order', 'INT NOT NULL DEFAULT 0')$$
CALL migration_add_column_if_missing('estimate_items', 'metadata_json', 'JSON NULL')$$

-- Cover the multi-estimate selectors and active-row reads used by the APIs.
CALL migration_add_index_if_missing('estimates', 'idx_estimates_project_active_updated',
    'INDEX `idx_estimates_project_active_updated` (`project_id`, `deleted_at`, `updated_at`)')$$
CALL migration_add_index_if_missing('takeoff_layers', 'uq_takeoff_layers_integration_key',
    'UNIQUE INDEX `uq_takeoff_layers_integration_key` (`takeoff_id`, `integration_key`)')$$
CALL migration_add_index_if_missing('takeoff_layers', 'uq_takeoff_layers_drawing_integration',
    'UNIQUE INDEX `uq_takeoff_layers_drawing_integration` (`drawing_id`, `integration_key`)')$$
CALL migration_add_index_if_missing('estimate_items', 'idx_estimate_items_source_layer',
    'INDEX `idx_estimate_items_source_layer` (`estimate_id`, `source_layer_key`, `deleted_at`)')$$
CALL migration_add_index_if_missing('estimate_items', 'idx_estimate_items_estimate_active_sort',
    'INDEX `idx_estimate_items_estimate_active_sort` (`estimate_id`, `deleted_at`, `sort_order`)')$$

DELIMITER ;

-- Full serialized workspace state. Relational rows remain authoritative for
-- searchable items/totals; state_json preserves UI-only state and future fields.
CREATE TABLE IF NOT EXISTS estimate_workspace_states (
    estimate_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    client_estimate_id VARCHAR(191) NOT NULL,
    state_json JSON NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (estimate_id),
    UNIQUE KEY uq_estimate_workspace_project_client (project_id, client_estimate_id),
    CONSTRAINT fk_estimate_workspace_states_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
    CONSTRAINT fk_estimate_workspace_states_project
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrade an estimate_workspace_states table created by an earlier revision.
CALL migration_add_column_if_missing(
    'estimate_workspace_states', 'project_id', 'BIGINT UNSIGNED NULL AFTER `estimate_id`'
);
CALL migration_add_column_if_missing(
    'estimate_workspace_states', 'client_estimate_id', 'VARCHAR(191) NULL AFTER `project_id`'
);

UPDATE estimate_workspace_states ews
INNER JOIN estimates e ON e.id = ews.estimate_id
SET ews.project_id = e.project_id
WHERE ews.project_id IS NULL;

UPDATE estimate_workspace_states
SET client_estimate_id = CONCAT('db-estimate-', estimate_id)
WHERE client_estimate_id IS NULL OR client_estimate_id = '';

ALTER TABLE estimate_workspace_states
    MODIFY project_id BIGINT UNSIGNED NOT NULL,
    MODIFY client_estimate_id VARCHAR(191) NOT NULL;

CALL migration_add_index_if_missing(
    'estimate_workspace_states',
    'uq_estimate_workspace_project_client',
    'UNIQUE INDEX `uq_estimate_workspace_project_client` (`project_id`, `client_estimate_id`)'
);
CALL migration_add_fk_if_missing(
    'estimate_workspace_states',
    'fk_estimate_workspace_states_project',
    'FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE'
);

-- Backfill stable keys without replacing any key supplied by an earlier import.
UPDATE takeoff_layers
SET integration_key = CONCAT('db-layer-', id)
WHERE integration_key IS NULL OR integration_key = '';

-- Mirror the stable layer key onto linked estimate items. This is deliberately
-- repeatable and does not affect manual estimate rows.
UPDATE estimate_items ei
INNER JOIN takeoff_layers tl ON tl.id = ei.takeoff_layer_id
SET ei.source_layer_key = tl.integration_key
WHERE ei.source_layer_key IS NULL OR ei.source_layer_key = '';

DROP PROCEDURE IF EXISTS migration_add_column_if_missing;
DROP PROCEDURE IF EXISTS migration_add_index_if_missing;
DROP PROCEDURE IF EXISTS migration_add_fk_if_missing;
