-- Additive Cost Catalog revision and audit support (MySQL 8+, idempotent).
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS catalog_add_column_if_missing;
DROP PROCEDURE IF EXISTS catalog_add_index_if_missing;
DELIMITER //
CREATE PROCEDURE catalog_add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=p_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column) THEN
        SET @catalog_ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE catalog_stmt FROM @catalog_ddl; EXECUTE catalog_stmt; DEALLOCATE PREPARE catalog_stmt;
    END IF;
END//
CREATE PROCEDURE catalog_add_index_if_missing(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=p_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=p_table AND index_name=p_index) THEN
        SET @catalog_ddl = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
        PREPARE catalog_stmt FROM @catalog_ddl; EXECUTE catalog_stmt; DEALLOCATE PREPARE catalog_stmt;
    END IF;
END//
DELIMITER ;

CALL catalog_add_column_if_missing('catalogs', 'revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `enabled_for_projects`');
CALL catalog_add_column_if_missing('cost_catalogs', 'revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `active`');
CALL catalog_add_column_if_missing('catalog_groups', 'revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `enabled_for_projects`');
CALL catalog_add_column_if_missing('catalog_items', 'revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `active`');
CALL catalog_add_column_if_missing('assembly_parts', 'revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `metadata_json`');

CREATE TABLE IF NOT EXISTS catalog_audit_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_id VARCHAR(64) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(32) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    catalog_id BIGINT UNSIGNED NULL,
    revision_before BIGINT UNSIGNED NULL,
    revision_after BIGINT UNSIGNED NULL,
    before_json JSON NULL,
    after_json JSON NULL,
    changes_json JSON NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_catalog_audit_request_entity (request_id, entity_type, entity_id, action),
    KEY idx_catalog_audit_entity (entity_type, entity_id, id),
    KEY idx_catalog_audit_catalog (catalog_id, id),
    KEY idx_catalog_audit_actor (actor_user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL catalog_add_index_if_missing('catalogs', 'idx_catalogs_project_availability', 'INDEX `idx_catalogs_project_availability` (`active`,`enabled_for_projects`,`deleted_at`,`id`)');
CALL catalog_add_index_if_missing('catalog_groups', 'idx_catalog_groups_availability', 'INDEX `idx_catalog_groups_availability` (`catalog_id`,`active`,`enabled_for_projects`,`deleted_at`,`parent_group_id`,`id`)');
CALL catalog_add_index_if_missing('catalog_items', 'idx_catalog_items_availability', 'INDEX `idx_catalog_items_availability` (`catalog_id`,`catalog_group_id`,`active`,`deleted_at`,`item_type`,`id`)');
CALL catalog_add_index_if_missing('cost_catalogs', 'idx_cost_catalogs_availability', 'INDEX `idx_cost_catalogs_availability` (`catalog_id`,`active`,`deleted_at`,`effective_from`,`effective_to`,`id`)');

DROP PROCEDURE IF EXISTS catalog_add_column_if_missing;
DROP PROCEDURE IF EXISTS catalog_add_index_if_missing;
