-- ==============================================================================
-- Migration: 20261009_users_active_for_won_project.sql
-- Task: TASK-0096
-- Objective: Add `active` column with default 1 and an index to `users` table
--            to support authorization closing the administrative bypass for
--            the Won Takeoff flow.
-- Target DB: MariaDB 10.4+ / MySQL 8.0+
-- Engine: InnoDB
-- Charset: utf8mb4
--
-- Idempotency:
--   Uses `IF NOT EXISTS` for column and index creation to allow safe re-execution.
--
-- DO NOT EXECUTE:
--   Per task constraints, this migration is prepared for future deployment and
--   must NOT be executed during this task.
-- ==============================================================================

-- 1. Add `active` column idempotently (default 1 = active)
ALTER TABLE `users`
    ADD COLUMN IF NOT EXISTS `active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `role`;

-- 2. Add composite index on `(active, role)` for efficient active admin lookups
ALTER TABLE `users`
    ADD INDEX IF NOT EXISTS `idx_users_active_role` (`active`, `role`);

-- ==============================================================================
-- NON-DESTRUCTIVE ROLLBACK DOCUMENTATION
-- ==============================================================================
-- A destructive rollback (`ALTER TABLE users DROP COLUMN active;`) would permanently
-- destroy any deactivation states applied to user records.
--
-- Non-destructive rollback procedure:
-- 1. Application-level rollback:
--    Revert code to ignore the `active` column. The presence of `active` column
--    with default 1 does not interfere with legacy queries selecting only `role`.
--
-- 2. Index removal (optional, non-destructive to data):
--    ALTER TABLE `users` DROP INDEX IF EXISTS `idx_users_active_role`;
--
-- 3. Reset state (if any users were marked inactive during testing/operation):
--    UPDATE `users` SET `active` = 1 WHERE `active` != 1;
--
-- 4. Destructive rollback (ONLY if column must be completely removed in development):
--    -- WARNING: This will permanently delete the column and any deactivation state.
--    -- ALTER TABLE `users` DROP COLUMN IF EXISTS `active`;
-- ==============================================================================
