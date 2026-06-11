-- Catalog Items modal and actions migration.
-- MySQL 8+, InnoDB, utf8mb4.

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER //
CREATE PROCEDURE add_column_if_missing(
    IN table_name_in VARCHAR(64),
    IN column_name_in VARCHAR(64),
    IN alter_sql_in TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = table_name_in
          AND COLUMN_NAME = column_name_in
    ) THEN
        SET @ddl = alter_sql_in;
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END//
DELIMITER ;

CALL add_column_if_missing('catalog_items', 'taxable', 'ALTER TABLE catalog_items ADD COLUMN taxable TINYINT(1) NOT NULL DEFAULT 1');
CALL add_column_if_missing('catalog_items', 'color', 'ALTER TABLE catalog_items ADD COLUMN color VARCHAR(50) NULL');
CALL add_column_if_missing('catalog_items', 'symbol', 'ALTER TABLE catalog_items ADD COLUMN symbol VARCHAR(50) NULL');
CALL add_column_if_missing('catalog_items', 'manufacturer', 'ALTER TABLE catalog_items ADD COLUMN manufacturer VARCHAR(191) NULL');
CALL add_column_if_missing('catalog_items', 'supplier', 'ALTER TABLE catalog_items ADD COLUMN supplier VARCHAR(191) NULL');
CALL add_column_if_missing('catalog_items', 'catalog_number', 'ALTER TABLE catalog_items ADD COLUMN catalog_number VARCHAR(100) NULL');
CALL add_column_if_missing('catalog_items', 'cost_code', 'ALTER TABLE catalog_items ADD COLUMN cost_code VARCHAR(100) NULL');
CALL add_column_if_missing('catalog_items', 'sub_job_code', 'ALTER TABLE catalog_items ADD COLUMN sub_job_code VARCHAR(100) NULL');
CALL add_column_if_missing('catalog_items', 'sub_job_name', 'ALTER TABLE catalog_items ADD COLUMN sub_job_name VARCHAR(191) NULL');
CALL add_column_if_missing('catalog_items', 'epd_url', 'ALTER TABLE catalog_items ADD COLUMN epd_url VARCHAR(1024) NULL');
CALL add_column_if_missing('catalog_items', 'attachment_url', 'ALTER TABLE catalog_items ADD COLUMN attachment_url VARCHAR(1024) NULL');

ALTER TABLE catalog_items
    MODIFY item_type ENUM('part','material','assembly','labor','equipment','subcontractor','travel','custom') NOT NULL DEFAULT 'material';

DROP PROCEDURE IF EXISTS add_column_if_missing;
