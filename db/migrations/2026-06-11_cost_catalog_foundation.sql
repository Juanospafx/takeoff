-- Cost Catalog foundation migration.
-- MySQL 8+, InnoDB, utf8mb4.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS catalogs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    trade VARCHAR(100) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    locked TINYINT(1) NOT NULL DEFAULT 0,
    enabled_for_projects TINYINT(1) NOT NULL DEFAULT 1,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_catalogs_active_deleted (active, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_groups (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    catalog_id BIGINT UNSIGNED NOT NULL,
    parent_group_id BIGINT UNSIGNED NULL,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    enabled_for_projects TINYINT(1) NOT NULL DEFAULT 1,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_catalog_groups_catalog (catalog_id),
    KEY idx_catalog_groups_parent (parent_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CALL add_column_if_missing('catalogs', 'locked', 'ALTER TABLE catalogs ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0 AFTER active');
CALL add_column_if_missing('catalogs', 'enabled_for_projects', 'ALTER TABLE catalogs ADD COLUMN enabled_for_projects TINYINT(1) NOT NULL DEFAULT 1 AFTER locked');
CALL add_column_if_missing('catalog_groups', 'active', 'ALTER TABLE catalog_groups ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER sort_order');
CALL add_column_if_missing('catalog_groups', 'enabled_for_projects', 'ALTER TABLE catalog_groups ADD COLUMN enabled_for_projects TINYINT(1) NOT NULL DEFAULT 1 AFTER active');

DROP PROCEDURE IF EXISTS add_column_if_missing;
