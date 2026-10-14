-- ==============================================================================
-- Migration: 20261012_sso_identity_links.sql
-- Task: TASK-0256
-- Objective: Additive MariaDB 10.11+ migration creating exact unique
--            provider + hub_user_id links to users.id, with active flag,
--            indexes, timestamps and documented rollback.
-- Target DB: MariaDB 10.11+ / MySQL 8.0+
-- Engine: InnoDB
-- Charset: utf8mb4
-- Collation: utf8mb4_unicode_ci
--
-- Idempotency:
--   Uses `CREATE TABLE IF NOT EXISTS` for safe re-execution.
--
-- DO NOT EXECUTE:
--   Per task constraints, this migration is prepared for future deployment and
--   must NOT be executed during this task. Static review only; no SQL execution.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `sso_identity_links` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `hub_user_id` VARCHAR(191) NOT NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_sso_identity_links_provider_hub_user` (`provider`, `hub_user_id`),
    KEY `idx_sso_identity_links_user_id` (`user_id`),
    KEY `idx_sso_identity_links_provider_active` (`provider`, `active`),
    CONSTRAINT `fk_sso_identity_links_user_id`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- ROLLBACK DOCUMENTATION
-- ==============================================================================
--
-- Procedure 1: Application-level rollback (non-destructive):
--   1. Revert application code to cease querying `sso_identity_links`.
--   2. The table and foreign keys remain dormant without impacting legacy local
--      authentication or direct user queries.
--
-- Procedure 2: Deactivation rollback (non-destructive):
--   1. Mark all existing links inactive if federated access must be revoked
--      immediately without dropping persistence records:
--      UPDATE `sso_identity_links` SET `active` = 0;
--
-- Procedure 3: Destructive rollback (maintenance window / cleanup only):
--   -- WARNING: Permanently removes all federated identity link mappings.
--   -- DROP TABLE IF EXISTS `sso_identity_links`;
-- ==============================================================================
