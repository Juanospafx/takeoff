-- Bid Board module migration.
-- MySQL 8+, InnoDB, utf8mb4.
-- Does not create users, permissions, roles or auth tables.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS estimators (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    display_name VARCHAR(191) NOT NULL,
    email VARCHAR(191) NULL,
    phone VARCHAR(100) NULL,
    company_name VARCHAR(191) NULL,
    trade VARCHAR(100) NULL,
    metadata_json JSON NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_estimators_active_deleted (active, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bid_statuses (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_terminal TINYINT(1) NOT NULL DEFAULT 0,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bid_statuses_code (code),
    KEY idx_bid_statuses_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bids (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NULL,
    estimating_id BIGINT UNSIGNED NULL,
    bid_status_id BIGINT UNSIGNED NULL,
    estimator_id BIGINT UNSIGNED NULL,
    bid_number VARCHAR(100) NULL,
    name VARCHAR(191) NOT NULL,
    requester_company VARCHAR(191) NULL,
    project_name_snapshot VARCHAR(191) NULL,
    due_at DATETIME NULL,
    submitted_at DATETIME NULL,
    awarded_at DATETIME NULL,
    total_amount DECIMAL(18,4) NOT NULL DEFAULT 0,
    currency_code CHAR(3) NOT NULL DEFAULT 'USD',
    notes TEXT NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_bids_status (bid_status_id),
    KEY idx_bids_estimator (estimator_id),
    KEY idx_bids_due (due_at),
    KEY idx_bids_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bids MODIFY project_id BIGINT UNSIGNED NULL;

SET @has_requester_company := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bids' AND COLUMN_NAME = 'requester_company'
);
SET @sql := IF(@has_requester_company = 0,
    'ALTER TABLE bids ADD COLUMN requester_company VARCHAR(191) NULL AFTER name',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_project_name_snapshot := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bids' AND COLUMN_NAME = 'project_name_snapshot'
);
SET @sql := IF(@has_project_name_snapshot = 0,
    'ALTER TABLE bids ADD COLUMN project_name_snapshot VARCHAR(191) NULL AFTER requester_company',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO bid_statuses (code, name, sort_order, is_terminal) VALUES
    ('invitations', 'Invitations', 10, 0),
    ('to_do', 'To Do', 20, 0),
    ('estimating', 'Estimating', 30, 0),
    ('bid_submitted', 'Bid Submitted', 40, 0),
    ('accepted', 'Accepted', 50, 0),
    ('in_progress', 'In Progress', 60, 0),
    ('complete', 'Complete', 70, 1),
    ('estimadores', 'Estimadores', 80, 0),
    ('lost', 'Lost', 90, 1),
    ('archived', 'Archived', 100, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order), is_terminal = VALUES(is_terminal);
