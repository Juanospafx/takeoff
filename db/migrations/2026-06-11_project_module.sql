-- Project Module migration.
-- MySQL 8+, InnoDB, utf8mb4.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS project_templates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    trade VARCHAR(100) NULL,
    settings_json JSON NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_project_templates_active_deleted (active, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_template_id BIGINT UNSIGNED NULL,
    estimator_id BIGINT UNSIGNED NULL,
    project_number VARCHAR(100) NULL,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    client_name VARCHAR(191) NULL,
    job_address VARCHAR(255) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    postal_code VARCHAR(30) NULL,
    country VARCHAR(100) NULL,
    bid_due_at DATETIME NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_projects_template (project_template_id),
    KEY idx_projects_status_deleted (status, deleted_at),
    KEY idx_projects_bid_due (bid_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO project_templates (name, description, trade, settings_json, active)
SELECT 'Electrical Bid Template', 'Basic electrical estimating project template', 'Electrical', JSON_OBJECT('default_status', 'draft'), 1
WHERE NOT EXISTS (SELECT 1 FROM project_templates WHERE deleted_at IS NULL LIMIT 1);
