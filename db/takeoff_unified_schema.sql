-- ==============================================================================
-- TAKEOFF & ESTIMATING SUITE - UNIFIED COMPLETE DATABASE SCHEMA
-- Compatible with MySQL 8.0+ / MariaDB 10.4+
-- Charset: utf8mb4, Collation: utf8mb4_unicode_ci, Engine: InnoDB
-- Includes all base tables, modules, migrations (up to 2026-09-02), and seed data.
-- ==============================================================================

-- 1. Optional Database Creation (Uncomment if needed)
CREATE DATABASE IF NOT EXISTS `brightro_takeoff` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `brightro_takeoff`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

-- ==============================================================================
-- 1. AUTHENTICATION & ACCESS CONTROL
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'viewer',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_username` (`username`),
    KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 2. ESTIMATORS & PROJECT TEMPLATES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `estimators` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `display_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(100) NULL,
    `company_name` VARCHAR(191) NULL,
    `trade` VARCHAR(100) NULL,
    `metadata_json` JSON NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_estimators_email` (`email`),
    KEY `idx_estimators_active_deleted` (`active`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_templates` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `trade` VARCHAR(100) NULL,
    `settings_json` JSON NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_project_templates_active_deleted` (`active`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 3. PROJECTS & DIRECTORY STRUCTURE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `projects` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_template_id` BIGINT UNSIGNED NULL,
    `estimator_id` BIGINT UNSIGNED NULL,
    `project_number` VARCHAR(100) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Active',
    `notes` TEXT NULL,
    `client_name` VARCHAR(191) NULL,
    `address` VARCHAR(255) NULL,
    `job_address` VARCHAR(255) NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `postal_code` VARCHAR(30) NULL,
    `country` VARCHAR(100) NULL,
    `contact_name` VARCHAR(191) NULL,
    `contact_phone` VARCHAR(100) NULL,
    `company_name` VARCHAR(191) NULL,
    `company_phone` VARCHAR(100) NULL,
    `company_address` VARCHAR(255) NULL,
    `date_bid_sent` DATE NULL,
    `date_bid_awarded` DATE NULL,
    `date_started` DATE NULL,
    `date_finished` DATE NULL,
    `date_warranty_end` DATE NULL,
    `bid_due_at` DATETIME NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `assigned_user_id` BIGINT UNSIGNED NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_projects_project_number` (`project_number`),
    KEY `idx_projects_template` (`project_template_id`),
    KEY `idx_projects_estimator` (`estimator_id`),
    KEY `idx_projects_status_deleted` (`status`, `deleted_at`),
    KEY `idx_projects_bid_due` (`bid_due_at`),
    KEY `idx_projects_deleted` (`deleted_at`),
    KEY `idx_projects_created` (`created_at`),
    CONSTRAINT `fk_projects_template` FOREIGN KEY (`project_template_id`) REFERENCES `project_templates` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_projects_estimator` FOREIGN KEY (`estimator_id`) REFERENCES `estimators` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `folders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_folders_project` (`project_id`),
    KEY `idx_folders_deleted` (`deleted_at`),
    CONSTRAINT `fk_folders_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sub_folders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `folder_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_sub_folders_folder` (`folder_id`),
    CONSTRAINT `fk_sub_folders_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `files` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NULL,
    `folder_id` BIGINT UNSIGNED NULL,
    `sub_folder_id` BIGINT UNSIGNED NULL,
    `filename` VARCHAR(255) NOT NULL,
    `filepath` VARCHAR(1024) NOT NULL,
    `file_type` VARCHAR(100) NULL,
    `uploaded_by` BIGINT UNSIGNED NULL,
    `version_group_id` VARCHAR(100) NULL,
    `version_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `uploaded_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_files_project` (`project_id`),
    KEY `idx_files_folder` (`folder_id`),
    KEY `idx_files_sub_folder` (`sub_folder_id`),
    KEY `idx_files_deleted` (`deleted_at`),
    KEY `idx_files_uploaded` (`uploaded_at`),
    CONSTRAINT `fk_files_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_files_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_files_sub_folder` FOREIGN KEY (`sub_folder_id`) REFERENCES `sub_folders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `file_reports` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `file_id` BIGINT UNSIGNED NOT NULL,
    `technician_name` VARCHAR(191) NULL,
    `technician_role` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `report_pdf_path` VARCHAR(1024) NULL,
    `annotations_json` JSON NULL,
    `attachments_json` JSON NULL,
    `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_file_reports_file` (`file_id`),
    KEY `idx_file_reports_deleted` (`is_deleted`),
    CONSTRAINT `fk_file_reports_file` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `field_report_attachments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `field_report_id` BIGINT UNSIGNED NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `file_size` BIGINT UNSIGNED NOT NULL,
    `storage_path` VARCHAR(1024) NOT NULL,
    `public_url` VARCHAR(1024) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_fra_report` (`field_report_id`),
    KEY `idx_fra_created_at` (`created_at`),
    CONSTRAINT `fk_fra_report` FOREIGN KEY (`field_report_id`) REFERENCES `file_reports` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 4. CUSTOMERS & BID BOARD
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `customers` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `company` VARCHAR(255) NOT NULL,
    `contact_name` VARCHAR(255) NULL,
    `phone` VARCHAR(100) NULL,
    `email` VARCHAR(255) NULL,
    `address` TEXT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_customers_company` (`company`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bid_statuses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `is_terminal` TINYINT(1) NOT NULL DEFAULT 0,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_bid_statuses_code` (`code`),
    KEY `idx_bid_statuses_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `estimating` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `estimator_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `currency_code` CHAR(3) NOT NULL DEFAULT 'USD',
    `settings_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_estimating_project` (`project_id`),
    KEY `idx_estimating_estimator` (`estimator_id`),
    KEY `idx_estimating_status_deleted` (`status`, `deleted_at`),
    CONSTRAINT `fk_estimating_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_estimating_estimator` FOREIGN KEY (`estimator_id`) REFERENCES `estimators` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bids` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NULL,
    `estimating_id` BIGINT UNSIGNED NULL,
    `bid_status_id` BIGINT UNSIGNED NULL,
    `estimator_id` BIGINT UNSIGNED NULL,
    `bid_number` VARCHAR(100) NULL,
    `name` VARCHAR(191) NOT NULL,
    `requester_company` VARCHAR(191) NULL,
    `project_name_snapshot` VARCHAR(191) NULL,
    `due_at` DATETIME NULL,
    `submitted_at` DATETIME NULL,
    `awarded_at` DATETIME NULL,
    `total_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `currency_code` CHAR(3) NOT NULL DEFAULT 'USD',
    `notes` TEXT NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_bids_bid_number` (`bid_number`),
    KEY `idx_bids_project` (`project_id`),
    KEY `idx_bids_estimating` (`estimating_id`),
    KEY `idx_bids_status` (`bid_status_id`),
    KEY `idx_bids_estimator` (`estimator_id`),
    KEY `idx_bids_due` (`due_at`),
    KEY `idx_bids_deleted` (`deleted_at`),
    CONSTRAINT `fk_bids_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_bids_estimating` FOREIGN KEY (`estimating_id`) REFERENCES `estimating` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_bids_status` FOREIGN KEY (`bid_status_id`) REFERENCES `bid_statuses` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_bids_estimator` FOREIGN KEY (`estimator_id`) REFERENCES `estimators` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 5. COST CATALOG & ASSEMBLIES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `catalogs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `trade` VARCHAR(100) NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `locked` TINYINT(1) NOT NULL DEFAULT 0,
    `enabled_for_projects` TINYINT(1) NOT NULL DEFAULT 1,
    `sort_order` INT NOT NULL DEFAULT 0,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_catalogs_active_deleted` (`active`, `deleted_at`),
    KEY `idx_catalogs_sort` (`deleted_at`, `sort_order`, `name`, `id`),
    KEY `idx_catalogs_project_availability` (`active`, `enabled_for_projects`, `deleted_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cost_catalogs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `catalog_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `currency_code` CHAR(3) NOT NULL DEFAULT 'USD',
    `effective_from` DATE NULL,
    `effective_to` DATE NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_cost_catalogs_catalog` (`catalog_id`),
    KEY `idx_cost_catalogs_effective` (`effective_from`, `effective_to`),
    KEY `idx_cost_catalogs_availability` (`catalog_id`, `active`, `deleted_at`, `effective_from`, `effective_to`, `id`),
    CONSTRAINT `fk_cost_catalogs_catalog` FOREIGN KEY (`catalog_id`) REFERENCES `catalogs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_groups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `catalog_id` BIGINT UNSIGNED NOT NULL,
    `parent_group_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `enabled_for_projects` TINYINT(1) NOT NULL DEFAULT 1,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_catalog_groups_catalog` (`catalog_id`),
    KEY `idx_catalog_groups_parent` (`parent_group_id`),
    KEY `idx_catalog_groups_availability` (`catalog_id`, `active`, `enabled_for_projects`, `deleted_at`, `parent_group_id`, `id`),
    KEY `idx_catalog_groups_siblings` (`catalog_id`, `parent_group_id`, `deleted_at`, `sort_order`, `name`),
    CONSTRAINT `fk_catalog_groups_catalog` FOREIGN KEY (`catalog_id`) REFERENCES `catalogs` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_catalog_groups_parent` FOREIGN KEY (`parent_group_id`) REFERENCES `catalog_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `catalog_id` BIGINT UNSIGNED NOT NULL,
    `cost_catalog_id` BIGINT UNSIGNED NULL,
    `catalog_group_id` BIGINT UNSIGNED NULL,
    `sku` VARCHAR(100) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `item_type` ENUM('part','material','assembly','labor','equipment','subcontractor','travel','custom') NOT NULL DEFAULT 'material',
    `cost_type` VARCHAR(100) NULL,
    `unit_of_measure` VARCHAR(50) NOT NULL DEFAULT 'ea',
    `measurement_type` VARCHAR(32) NOT NULL DEFAULT 'count',
    `unit_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `material_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `labor_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `equipment_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `subcontractor_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `labor_hours` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `labor_rate` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `markup_percent` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `waste_factor_percent` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `size` VARCHAR(100) NULL,
    `diameter` VARCHAR(100) NULL,
    `trade_size` VARCHAR(100) NULL,
    `thickness` VARCHAR(100) NULL,
    `gauge` VARCHAR(100) NULL,
    `material` VARCHAR(100) NULL,
    `color` VARCHAR(50) NULL,
    `symbol` VARCHAR(50) NULL,
    `marker_size` DECIMAL(9,4) NULL,
    `taxable` TINYINT(1) NOT NULL DEFAULT 1,
    `manufacturer` VARCHAR(191) NULL,
    `supplier` VARCHAR(191) NULL,
    `catalog_number` VARCHAR(100) NULL,
    `sub_job_code` VARCHAR(100) NULL,
    `sub_job_name` VARCHAR(191) NULL,
    `epd_url` VARCHAR(1024) NULL,
    `cost_code` VARCHAR(100) NULL,
    `masterformat` VARCHAR(100) NULL,
    `uniformat` VARCHAR(100) NULL,
    `attachment_url` VARCHAR(1024) NULL,
    `tags_json` JSON NULL,
    `attributes_json` JSON NULL,
    `notes` TEXT NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_catalog_items_catalog` (`catalog_id`),
    KEY `idx_catalog_items_cost_catalog` (`cost_catalog_id`),
    KEY `idx_catalog_items_group` (`catalog_group_id`),
    KEY `idx_catalog_items_sku` (`sku`),
    KEY `idx_catalog_items_type` (`item_type`),
    KEY `idx_catalog_items_active_deleted` (`active`, `deleted_at`),
    KEY `idx_catalog_items_availability` (`catalog_id`, `catalog_group_id`, `active`, `deleted_at`, `item_type`, `id`),
    KEY `idx_catalog_items_measurement` (`measurement_type`, `active`, `deleted_at`),
    CONSTRAINT `fk_catalog_items_catalog` FOREIGN KEY (`catalog_id`) REFERENCES `catalogs` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_catalog_items_cost_catalog` FOREIGN KEY (`cost_catalog_id`) REFERENCES `cost_catalogs` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_catalog_items_group` FOREIGN KEY (`catalog_group_id`) REFERENCES `catalog_groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_item_attributes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `catalog_item_id` BIGINT UNSIGNED NOT NULL,
    `attribute_name` VARCHAR(100) NOT NULL,
    `attribute_value` TEXT NULL,
    `value_type` VARCHAR(50) NOT NULL DEFAULT 'string',
    `unit_of_measure` VARCHAR(50) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_catalog_item_attributes_item` (`catalog_item_id`),
    KEY `idx_catalog_item_attributes_name` (`attribute_name`),
    CONSTRAINT `fk_catalog_item_attributes_item` FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_item_attachments` (
    `catalog_item_id` BIGINT UNSIGNED NOT NULL,
    `storage_name` CHAR(52) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(64) NOT NULL DEFAULT 'application/pdf',
    `size_bytes` BIGINT UNSIGNED NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploaded_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`catalog_item_id`),
    UNIQUE KEY `uq_catalog_item_attachment_storage` (`storage_name`),
    KEY `idx_catalog_item_attachment_sha256` (`sha256`),
    CONSTRAINT `fk_catalog_item_attachment_item` FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_audit_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id` VARCHAR(64) NOT NULL,
    `actor_user_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(32) NOT NULL,
    `entity_id` BIGINT UNSIGNED NOT NULL,
    `catalog_id` BIGINT UNSIGNED NULL,
    `revision_before` BIGINT UNSIGNED NULL,
    `revision_after` BIGINT UNSIGNED NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `changes_json` JSON NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_catalog_audit_request_entity` (`request_id`, `entity_type`, `entity_id`, `action`),
    KEY `idx_catalog_audit_entity` (`entity_type`, `entity_id`, `id`),
    KEY `idx_catalog_audit_catalog` (`catalog_id`, `id`),
    KEY `idx_catalog_audit_actor` (`actor_user_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `assembly_parts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `assembly_catalog_item_id` BIGINT UNSIGNED NOT NULL,
    `part_catalog_item_id` BIGINT UNSIGNED NOT NULL,
    `quantity` DECIMAL(18,6) NOT NULL DEFAULT 1,
    `unit_cost_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `unit_labor_time_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `ratio_type` ENUM('fixed','per_unit','per_linear_length','per_area','per_endpoint','spacing_based') NOT NULL DEFAULT 'per_unit',
    `spacing_value` DECIMAL(18,6) NULL,
    `waste_factor_percent` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `sort_order` INT NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `metadata_json` JSON NULL,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_assembly_parts_assembly` (`assembly_catalog_item_id`),
    KEY `idx_assembly_parts_part` (`part_catalog_item_id`),
    CONSTRAINT `fk_assembly_parts_assembly` FOREIGN KEY (`assembly_catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_assembly_parts_part` FOREIGN KEY (`part_catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 6. PROJECT DOCUMENTS & DRAWINGS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `document_folders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `parent_folder_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_document_folders_project` (`project_id`),
    KEY `idx_document_folders_parent` (`parent_folder_id`),
    CONSTRAINT `fk_document_folders_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_document_folders_parent` FOREIGN KEY (`parent_folder_id`) REFERENCES `document_folders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_documents` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `document_folder_id` BIGINT UNSIGNED NULL,
    `document_type` VARCHAR(100) NOT NULL DEFAULT 'document',
    `title` VARCHAR(191) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `storage_path` VARCHAR(1024) NOT NULL,
    `mime_type` VARCHAR(191) NULL,
    `file_size` BIGINT UNSIGNED NULL,
    `version_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_project_documents_project` (`project_id`),
    KEY `idx_project_documents_folder` (`document_folder_id`),
    KEY `idx_project_documents_type` (`document_type`),
    CONSTRAINT `fk_project_documents_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_project_documents_folder` FOREIGN KEY (`document_folder_id`) REFERENCES `document_folders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `drawings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `project_document_id` BIGINT UNSIGNED NULL,
    `drawing_number` VARCHAR(100) NULL,
    `title` VARCHAR(191) NOT NULL,
    `discipline` VARCHAR(100) NULL,
    `sheet_number` VARCHAR(100) NULL,
    `revision` VARCHAR(100) NULL,
    `page_count` INT UNSIGNED NOT NULL DEFAULT 1,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_drawings_project` (`project_id`),
    KEY `idx_drawings_document` (`project_document_id`),
    KEY `idx_drawings_number` (`drawing_number`),
    CONSTRAINT `fk_drawings_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_drawings_document` FOREIGN KEY (`project_document_id`) REFERENCES `project_documents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `drawing_scales` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `drawing_id` BIGINT UNSIGNED NOT NULL,
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `scale_name` VARCHAR(100) NOT NULL,
    `ratio` DECIMAL(18,8) NOT NULL,
    `unit` VARCHAR(50) NOT NULL DEFAULT 'ft',
    `pixels_per_unit` DECIMAL(18,8) NULL,
    `calibration_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_drawing_scales_drawing_page` (`drawing_id`, `page_number`),
    CONSTRAINT `fk_drawing_scales_drawing` FOREIGN KEY (`drawing_id`) REFERENCES `drawings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 7. TAKEOFF WORKSPACE & GEOMETRY
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `takeoffs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `drawing_id` BIGINT UNSIGNED NULL,
    `estimate_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_takeoffs_project` (`project_id`),
    KEY `idx_takeoffs_drawing` (`drawing_id`),
    KEY `idx_takeoffs_estimate` (`estimate_id`),
    KEY `idx_takeoffs_status_deleted` (`status`, `deleted_at`),
    CONSTRAINT `fk_takeoffs_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_takeoffs_drawing` FOREIGN KEY (`drawing_id`) REFERENCES `drawings` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_layers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `integration_key` VARCHAR(191) NULL,
    `takeoff_id` BIGINT UNSIGNED NOT NULL,
    `drawing_id` BIGINT UNSIGNED NULL,
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `project_id` BIGINT UNSIGNED NULL,
    `estimate_key` VARCHAR(191) NULL,
    `group_name` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(50) NOT NULL DEFAULT 'mixed',
    `layer_type` ENUM('count','linear','area','volume','mixed') NOT NULL DEFAULT 'mixed',
    `takeoff_type` VARCHAR(50) NOT NULL DEFAULT 'count',
    `unit_of_measure` VARCHAR(50) NOT NULL DEFAULT 'ea',
    `catalog_item_id` BIGINT UNSIGNED NULL,
    `assembly_id` BIGINT UNSIGNED NULL,
    `assembly_catalog_item_id` BIGINT UNSIGNED NULL,
    `color` VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    `symbol` VARCHAR(50) NOT NULL DEFAULT 'circle',
    `tag` VARCHAR(100) NULL,
    `symbol_size` VARCHAR(50) NULL,
    `quantity` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `visible` TINYINT(1) NOT NULL DEFAULT 1,
    `locked` TINYINT(1) NOT NULL DEFAULT 0,
    `sort_order` INT NOT NULL DEFAULT 0,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_takeoff_layers_takeoff` (`takeoff_id`),
    KEY `idx_takeoff_layers_drawing_page` (`drawing_id`, `page_number`),
    KEY `idx_takeoff_layers_catalog_item` (`catalog_item_id`),
    KEY `idx_takeoff_layers_assembly` (`assembly_catalog_item_id`),
    KEY `idx_takeoff_layers_estimate_drawing` (`estimate_key`, `drawing_id`),
    UNIQUE KEY `uq_takeoff_layers_integration_key` (`takeoff_id`, `integration_key`),
    UNIQUE KEY `uq_takeoff_layers_drawing_integration` (`drawing_id`, `integration_key`),
    CONSTRAINT `fk_takeoff_layers_takeoff` FOREIGN KEY (`takeoff_id`) REFERENCES `takeoffs` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_takeoff_layers_drawing` FOREIGN KEY (`drawing_id`) REFERENCES `drawings` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_takeoff_layers_catalog_item` FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_takeoff_layers_assembly` FOREIGN KEY (`assembly_catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_measurements` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `takeoff_id` BIGINT UNSIGNED NOT NULL,
    `takeoff_layer_id` BIGINT UNSIGNED NOT NULL,
    `drawing_id` BIGINT UNSIGNED NULL,
    `drawing_scale_id` BIGINT UNSIGNED NULL,
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `measurement_type` ENUM('count','linear','area','volume') NOT NULL,
    `catalog_item_id` BIGINT UNSIGNED NULL,
    `assembly_catalog_item_id` BIGINT UNSIGNED NULL,
    `geometry_json` JSON NOT NULL,
    `quantity` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `measured_value` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `multiplier` DECIMAL(18,6) NOT NULL DEFAULT 1,
    `unit_of_measure` VARCHAR(50) NOT NULL DEFAULT 'ea',
    `label` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_takeoff_measurements_takeoff` (`takeoff_id`),
    KEY `idx_takeoff_measurements_layer` (`takeoff_layer_id`),
    KEY `idx_takeoff_measurements_drawing_page` (`drawing_id`, `page_number`),
    KEY `idx_takeoff_measurements_item` (`catalog_item_id`),
    CONSTRAINT `fk_takeoff_measurements_takeoff` FOREIGN KEY (`takeoff_id`) REFERENCES `takeoffs` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_takeoff_measurements_layer` FOREIGN KEY (`takeoff_layer_id`) REFERENCES `takeoff_layers` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_takeoff_measurements_drawing` FOREIGN KEY (`drawing_id`) REFERENCES `drawings` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_takeoff_measurements_scale` FOREIGN KEY (`drawing_scale_id`) REFERENCES `drawing_scales` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_takeoff_measurements_item` FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_takeoff_measurements_assembly` FOREIGN KEY (`assembly_catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_tags` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(100) NOT NULL,
    `color` VARCHAR(50) NOT NULL DEFAULT '#64748b',
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_takeoff_tags_project` (`project_id`),
    UNIQUE KEY `uq_takeoff_tags_project_name` (`project_id`, `name`),
    CONSTRAINT `fk_takeoff_tags_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_measurement_tags` (
    `takeoff_measurement_id` BIGINT UNSIGNED NOT NULL,
    `takeoff_tag_id` BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (`takeoff_measurement_id`, `takeoff_tag_id`),
    KEY `idx_takeoff_measurement_tags_tag` (`takeoff_tag_id`),
    CONSTRAINT `fk_takeoff_measurement_tags_measurement` FOREIGN KEY (`takeoff_measurement_id`) REFERENCES `takeoff_measurements` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_takeoff_measurement_tags_tag` FOREIGN KEY (`takeoff_tag_id`) REFERENCES `takeoff_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Specialized geometry persistence for editor
CREATE TABLE IF NOT EXISTS `takeoff_drawing_states` (
    `drawing_id` BIGINT UNSIGNED NOT NULL,
    `project_id` BIGINT UNSIGNED NULL,
    `state_json` JSON NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`drawing_id`),
    KEY `idx_takeoff_drawing_states_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_sheet_scales` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NULL,
    `drawing_id` BIGINT UNSIGNED NOT NULL COMMENT 'files.id used by editor.php',
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `scale_name` VARCHAR(100) NOT NULL,
    `pixels_per_unit` DECIMAL(18,8) NOT NULL,
    `unit` VARCHAR(50) NOT NULL DEFAULT 'ft',
    `calibration_json` JSON NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `updated_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_takeoff_sheet_scale` (`drawing_id`, `page_number`),
    KEY `idx_takeoff_sheet_scales_project` (`project_id`),
    CONSTRAINT `fk_takeoff_sheet_scales_file` FOREIGN KEY (`drawing_id`) REFERENCES `files` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_takeoff_sheet_scales_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_count_markers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_uid` VARCHAR(191) NULL,
    `layer_id` BIGINT UNSIGNED NOT NULL,
    `catalog_item_id` BIGINT UNSIGNED NULL,
    `assembly_id` BIGINT UNSIGNED NULL,
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `x` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `y` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `symbol` VARCHAR(50) NOT NULL DEFAULT 'circle',
    `color` VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    `label` VARCHAR(191) NULL,
    `multiplier` DECIMAL(18,6) NOT NULL DEFAULT 1,
    `quantity` DECIMAL(18,6) NOT NULL DEFAULT 1,
    `notes` TEXT NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_takeoff_count_marker_uid` (`layer_id`, `client_uid`),
    KEY `idx_takeoff_count_marker_page` (`layer_id`, `page_number`),
    CONSTRAINT `fk_takeoff_count_marker_layer` FOREIGN KEY (`layer_id`) REFERENCES `takeoff_layers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_linear_segments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_uid` VARCHAR(191) NULL,
    `layer_id` BIGINT UNSIGNED NOT NULL,
    `catalog_item_id` BIGINT UNSIGNED NULL,
    `assembly_id` BIGINT UNSIGNED NULL,
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `points_json` JSON NOT NULL,
    `measured_length` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `multiplier` DECIMAL(18,6) NOT NULL DEFAULT 1,
    `total_length` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `unit` VARCHAR(50) NOT NULL DEFAULT 'ft',
    `color` VARCHAR(50) NOT NULL DEFAULT '#2563eb',
    `stroke_width` DECIMAL(10,4) NOT NULL DEFAULT 4,
    `label` VARCHAR(191) NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_takeoff_linear_segment_uid` (`layer_id`, `client_uid`),
    KEY `idx_takeoff_linear_segment_page` (`layer_id`, `page_number`),
    CONSTRAINT `fk_takeoff_linear_segment_layer` FOREIGN KEY (`layer_id`) REFERENCES `takeoff_layers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_measurement_summaries` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `drawing_id` BIGINT UNSIGNED NOT NULL,
    `summary_json` JSON NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_takeoff_summary_drawing_created` (`drawing_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_estimate_states` (
    `estimate_key` VARCHAR(191) NOT NULL,
    `drawing_id` BIGINT UNSIGNED NOT NULL,
    `project_id` BIGINT UNSIGNED NULL,
    `state_json` JSON NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`estimate_key`, `drawing_id`),
    KEY `idx_takeoff_estimate_states_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `takeoff_estimate_scales` (
    `estimate_key` VARCHAR(191) NOT NULL,
    `project_id` BIGINT UNSIGNED NULL,
    `drawing_id` BIGINT UNSIGNED NOT NULL,
    `page_number` INT UNSIGNED NOT NULL DEFAULT 1,
    `scale_name` VARCHAR(100) NOT NULL,
    `pixels_per_unit` DECIMAL(18,8) NOT NULL,
    `unit` VARCHAR(50) NOT NULL DEFAULT 'ft',
    `calibration_json` JSON NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `updated_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`estimate_key`, `drawing_id`, `page_number`),
    KEY `idx_takeoff_estimate_scales_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 8. ESTIMATING & PROPOSALS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `estimates` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `estimating_id` BIGINT UNSIGNED NULL,
    `takeoff_id` BIGINT UNSIGNED NULL,
    `bid_id` BIGINT UNSIGNED NULL,
    `estimate_number` VARCHAR(100) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `currency_code` CHAR(3) NOT NULL DEFAULT 'USD',
    `settings_json` JSON NULL,
    `notes_json` JSON NULL,
    `subtotal_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `markup_total` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `total_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `labor_hours_total` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_estimates_number` (`estimate_number`),
    KEY `idx_estimates_project` (`project_id`),
    KEY `idx_estimates_estimating` (`estimating_id`),
    KEY `idx_estimates_takeoff` (`takeoff_id`),
    KEY `idx_estimates_bid` (`bid_id`),
    KEY `idx_estimates_status_deleted` (`status`, `deleted_at`),
    KEY `idx_estimates_project_active_updated` (`project_id`, `deleted_at`, `updated_at`),
    CONSTRAINT `fk_estimates_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_estimates_estimating` FOREIGN KEY (`estimating_id`) REFERENCES `estimating` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_estimates_takeoff` FOREIGN KEY (`takeoff_id`) REFERENCES `takeoffs` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_estimates_bid` FOREIGN KEY (`bid_id`) REFERENCES `bids` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `estimate_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `estimate_id` BIGINT UNSIGNED NOT NULL,
    `parent_estimate_item_id` BIGINT UNSIGNED NULL,
    `takeoff_measurement_id` BIGINT UNSIGNED NULL,
    `takeoff_layer_id` BIGINT UNSIGNED NULL,
    `source_layer_key` VARCHAR(191) NULL,
    `catalog_item_id` BIGINT UNSIGNED NULL,
    `assembly_catalog_item_id` BIGINT UNSIGNED NULL,
    `source_type` VARCHAR(50) NOT NULL DEFAULT 'manual',
    `is_manual` TINYINT(1) NOT NULL DEFAULT 1,
    `is_quantity_locked_from_takeoff` TINYINT(1) NOT NULL DEFAULT 0,
    `item_type` VARCHAR(50) NOT NULL DEFAULT 'line_item',
    `group_name` VARCHAR(191) NULL,
    `budget_code` VARCHAR(100) NULL,
    `cost_type` VARCHAR(100) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `quantity` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `unit_of_measure` VARCHAR(50) NOT NULL DEFAULT 'ea',
    `unit_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `unit_labor_time` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `material_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `labor_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `equipment_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `subcontractor_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `labor_hours` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `waste_percentage` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `margin_percentage` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `taxable` TINYINT(1) NOT NULL DEFAULT 1,
    `waste_factor_percent` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `markup_percent` DECIMAL(9,4) NOT NULL DEFAULT 0,
    `subtotal_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `total_cost` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `sort_order` INT NOT NULL DEFAULT 0,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_estimate_items_estimate` (`estimate_id`),
    KEY `idx_estimate_items_parent` (`parent_estimate_item_id`),
    KEY `idx_estimate_items_measurement` (`takeoff_measurement_id`),
    KEY `idx_estimate_items_takeoff_layer` (`takeoff_layer_id`),
    KEY `idx_estimate_items_catalog_item` (`catalog_item_id`),
    KEY `idx_estimate_items_source_layer` (`estimate_id`, `source_layer_key`, `deleted_at`),
    KEY `idx_estimate_items_estimate_active_sort` (`estimate_id`, `deleted_at`, `sort_order`),
    CONSTRAINT `fk_estimate_items_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_estimate_items_parent` FOREIGN KEY (`parent_estimate_item_id`) REFERENCES `estimate_items` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_estimate_items_measurement` FOREIGN KEY (`takeoff_measurement_id`) REFERENCES `takeoff_measurements` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_estimate_items_takeoff_layer` FOREIGN KEY (`takeoff_layer_id`) REFERENCES `takeoff_layers` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_estimate_items_catalog_item` FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_estimate_items_assembly` FOREIGN KEY (`assembly_catalog_item_id`) REFERENCES `catalog_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `estimate_markups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `estimate_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `markup_type` ENUM('percentage','fixed','tax','discount') NOT NULL DEFAULT 'percentage',
    `basis` ENUM('subtotal','material','labor','equipment','subcontractor','total') NOT NULL DEFAULT 'subtotal',
    `value` DECIMAL(18,6) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `sort_order` INT NOT NULL DEFAULT 0,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_estimate_markups_estimate` (`estimate_id`),
    CONSTRAINT `fk_estimate_markups_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `estimate_workspace_states` (
    `estimate_id` BIGINT UNSIGNED NOT NULL,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `client_estimate_id` VARCHAR(191) NOT NULL,
    `state_json` JSON NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`estimate_id`),
    KEY `idx_estimate_workspace_project` (`project_id`),
    KEY `idx_estimate_workspace_client` (`client_estimate_id`),
    UNIQUE KEY `uq_estimate_workspace_project_client` (`project_id`, `client_estimate_id`),
    CONSTRAINT `fk_estimate_workspace_states_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_estimate_workspace_states_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proposals` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `estimate_id` BIGINT UNSIGNED NULL,
    `bid_id` BIGINT UNSIGNED NULL,
    `proposal_number` VARCHAR(100) NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `valid_until` DATE NULL,
    `subtotal` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `total` DECIMAL(18,4) NOT NULL DEFAULT 0,
    `currency_code` CHAR(3) NOT NULL DEFAULT 'USD',
    `terms` TEXT NULL,
    `scope` TEXT NULL,
    `exclusions` TEXT NULL,
    `metadata_json` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_proposals_number` (`proposal_number`),
    KEY `idx_proposals_project` (`project_id`),
    KEY `idx_proposals_estimate` (`estimate_id`),
    KEY `idx_proposals_bid` (`bid_id`),
    KEY `idx_proposals_status_deleted` (`status`, `deleted_at`),
    CONSTRAINT `fk_proposals_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_proposals_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_proposals_bid` FOREIGN KEY (`bid_id`) REFERENCES `bids` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 9. COMPANY SETTINGS & GLOBAL CONFIGURATION
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `company_settings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `setting_key` VARCHAR(100) NOT NULL,
    `setting_value` TEXT NULL,
    `value_type` VARCHAR(50) NOT NULL DEFAULT 'string',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_company_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `company_cost_types` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `company_project_statuses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `company_estimate_types` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `company_setting_users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `display_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `role_name` VARCHAR(100) NOT NULL DEFAULT 'Estimator',
    `status` VARCHAR(50) NOT NULL DEFAULT 'Active',
    `estimator_flag` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 10. BASELINE SEED DATA
-- ==============================================================================

-- Default Administrator (Username: admin | Password: admin123)
INSERT INTO `users` (`id`, `username`, `password`, `role`)
VALUES (1, 'admin', '$2y$10$yX9N96DbKBxbc64DtP7NbObuko/SdMGuOAh3MyyMe6sbTVj1tQ/3u', 'admin')
ON DUPLICATE KEY UPDATE `role` = 'admin';

-- Canonical Bid Statuses
INSERT INTO `bid_statuses` (`code`, `name`, `sort_order`, `is_terminal`) VALUES
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
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `sort_order` = VALUES(`sort_order`),
    `is_terminal` = VALUES(`is_terminal`);

-- Default Project Template
INSERT INTO `project_templates` (`id`, `name`, `description`, `trade`, `settings_json`, `active`)
VALUES (1, 'Electrical Bid Template', 'Basic electrical estimating project template', 'Electrical', JSON_OBJECT('default_status', 'draft'), 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Default Project & Drawings Folder for Takeoff
INSERT INTO `projects` (`id`, `name`, `description`, `status`)
VALUES (1, 'Default Takeoff Project', 'Default project for standalone Takeoff drawings', 'Active')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `folders` (`id`, `project_id`, `name`)
VALUES (1, 1, 'Drawings')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Initial Company Cost Types
INSERT INTO `company_cost_types` (`id`, `name`, `active`, `sort_order`) VALUES
    (1, 'Material', 1, 10),
    (2, 'Labor', 1, 20),
    (3, 'Equipment', 1, 30),
    (4, 'Subcontractor', 1, 40)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Initial Company Project Statuses
INSERT INTO `company_project_statuses` (`id`, `name`, `active`, `sort_order`) VALUES
    (1, 'Bidding', 1, 10),
    (2, 'Won', 1, 20),
    (3, 'In Progress', 1, 30),
    (4, 'Completed', 1, 40),
    (5, 'Lost', 1, 50)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Initial Company Estimate Types
INSERT INTO `company_estimate_types` (`id`, `name`, `active`, `sort_order`) VALUES
    (1, 'Budget', 1, 10),
    (2, 'Hard Bid', 1, 20),
    (3, 'Change Order', 1, 30)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- END OF UNIFIED SCHEMA
-- ==============================================================================
