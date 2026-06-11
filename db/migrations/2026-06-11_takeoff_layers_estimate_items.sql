-- Task 7/8 follow-up: Takeoff layer panel and Estimate Add Item fields.
-- Safe to run after the base schema; add columns only if missing manually on MySQL 8 installations.

ALTER TABLE takeoff_layers
    ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER page_number,
    ADD COLUMN group_name VARCHAR(191) NULL AFTER project_id,
    ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'mixed' AFTER name,
    ADD COLUMN takeoff_type VARCHAR(50) NOT NULL DEFAULT 'count' AFTER layer_type,
    ADD COLUMN unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea' AFTER takeoff_type,
    ADD COLUMN assembly_id BIGINT UNSIGNED NULL AFTER catalog_item_id,
    ADD COLUMN tag VARCHAR(100) NULL AFTER symbol,
    ADD COLUMN symbol_size VARCHAR(50) NULL AFTER symbol,
    ADD COLUMN quantity DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER symbol_size,
    ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER locked;

ALTER TABLE estimate_items
    ADD COLUMN takeoff_layer_id BIGINT UNSIGNED NULL AFTER takeoff_measurement_id,
    ADD COLUMN source_type VARCHAR(50) NOT NULL DEFAULT 'manual' AFTER assembly_catalog_item_id,
    ADD COLUMN is_manual TINYINT(1) NOT NULL DEFAULT 1 AFTER source_type,
    ADD COLUMN is_quantity_locked_from_takeoff TINYINT(1) NOT NULL DEFAULT 0 AFTER is_manual,
    ADD COLUMN group_name VARCHAR(191) NULL AFTER item_type,
    ADD COLUMN budget_code VARCHAR(100) NULL AFTER group_name,
    ADD COLUMN cost_type VARCHAR(100) NULL AFTER budget_code,
    ADD COLUMN unit_labor_time DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER unit_cost,
    ADD COLUMN waste_percentage DECIMAL(9,4) NOT NULL DEFAULT 0 AFTER labor_hours,
    ADD COLUMN margin_percentage DECIMAL(9,4) NOT NULL DEFAULT 0 AFTER waste_percentage,
    ADD COLUMN taxable TINYINT(1) NOT NULL DEFAULT 1 AFTER margin_percentage,
    ADD COLUMN subtotal_cost DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER markup_percent,
    ADD KEY idx_estimate_items_takeoff_layer (takeoff_layer_id);
