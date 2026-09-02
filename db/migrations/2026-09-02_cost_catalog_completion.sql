-- Cost Catalog completion fields and indexes (MySQL 8+, idempotent).
-- Schema evolution belongs in migrations; application requests must never run DDL.
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS cc_complete_add_column;
DROP PROCEDURE IF EXISTS cc_complete_add_index;
DELIMITER //
CREATE PROCEDURE cc_complete_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=p_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column) THEN
        SET @cc_ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE cc_stmt FROM @cc_ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
    END IF;
END//
CREATE PROCEDURE cc_complete_add_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=p_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=p_table AND index_name=p_index) THEN
        SET @cc_ddl = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
        PREPARE cc_stmt FROM @cc_ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
    END IF;
END//
DELIMITER ;

CALL cc_complete_add_column('catalogs', 'sort_order', 'INT NOT NULL DEFAULT 0 AFTER `enabled_for_projects`');
CALL cc_complete_add_column('catalog_items', 'measurement_type', "VARCHAR(32) NOT NULL DEFAULT 'count' AFTER `unit_of_measure`");
CALL cc_complete_add_column('catalog_items', 'marker_size', 'DECIMAL(9,4) NULL AFTER `symbol`');
CALL cc_complete_add_column('catalog_items', 'notes', 'TEXT NULL AFTER `attributes_json`');

CALL cc_complete_add_index('catalogs', 'idx_catalogs_sort', 'INDEX `idx_catalogs_sort` (`deleted_at`,`sort_order`,`name`,`id`)');
CALL cc_complete_add_index('catalog_items', 'idx_catalog_items_measurement', 'INDEX `idx_catalog_items_measurement` (`measurement_type`,`active`,`deleted_at`)');
CALL cc_complete_add_index('catalog_groups', 'idx_catalog_groups_siblings', 'INDEX `idx_catalog_groups_siblings` (`catalog_id`,`parent_group_id`,`deleted_at`,`sort_order`,`name`)');

DROP PROCEDURE IF EXISTS cc_complete_add_column;
DROP PROCEDURE IF EXISTS cc_complete_add_index;
