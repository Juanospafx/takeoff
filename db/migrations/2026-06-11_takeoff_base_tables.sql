-- Minimal base tables required by the standalone Takeoff editor.
-- Run this on brightro_takeoff if takeoff_mysql_schema.sql was imported before these tables existed.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    notes TEXT NULL,
    address VARCHAR(255) NULL,
    contact_name VARCHAR(191) NULL,
    contact_phone VARCHAR(100) NULL,
    company_name VARCHAR(191) NULL,
    company_phone VARCHAR(100) NULL,
    company_address VARCHAR(255) NULL,
    date_bid_sent DATE NULL,
    date_bid_awarded DATE NULL,
    date_started DATE NULL,
    date_finished DATE NULL,
    date_warranty_end DATE NULL,
    created_by BIGINT UNSIGNED NULL,
    assigned_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_projects_deleted (deleted_at),
    KEY idx_projects_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS folders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_folders_project (project_id),
    KEY idx_folders_deleted (deleted_at),
    CONSTRAINT fk_folders_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sub_folders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    folder_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_sub_folders_folder (folder_id),
    CONSTRAINT fk_sub_folders_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NULL,
    folder_id BIGINT UNSIGNED NULL,
    sub_folder_id BIGINT UNSIGNED NULL,
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(1024) NOT NULL,
    file_type VARCHAR(100) NULL,
    uploaded_by BIGINT UNSIGNED NULL,
    version_group_id VARCHAR(100) NULL,
    version_number INT UNSIGNED NOT NULL DEFAULT 1,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_files_project (project_id),
    KEY idx_files_folder (folder_id),
    KEY idx_files_sub_folder (sub_folder_id),
    KEY idx_files_deleted (deleted_at),
    KEY idx_files_uploaded (uploaded_at),
    CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
    CONSTRAINT fk_files_sub_folder FOREIGN KEY (sub_folder_id) REFERENCES sub_folders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    file_id BIGINT UNSIGNED NOT NULL,
    technician_name VARCHAR(191) NULL,
    technician_role VARCHAR(191) NULL,
    description TEXT NULL,
    report_pdf_path VARCHAR(1024) NULL,
    annotations_json JSON NULL,
    attachments_json JSON NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_file_reports_file (file_id),
    KEY idx_file_reports_deleted (is_deleted),
    CONSTRAINT fk_file_reports_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO projects (id, name, description, status)
VALUES (1, 'Default Takeoff Project', 'Default project for standalone Takeoff drawings', 'Active')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO folders (id, project_id, name)
VALUES (1, 1, 'Drawings')
ON DUPLICATE KEY UPDATE name = VALUES(name);
