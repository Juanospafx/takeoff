-- Project-scoped access control. Hub remains the identity authority; user_id is
-- the local shadow identity used only for foreign keys and audit.
CREATE TABLE IF NOT EXISTS `project_members` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `member_role` VARCHAR(32) NOT NULL DEFAULT 'viewer',
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_project_members_project_user` (`project_id`, `user_id`),
    KEY `idx_project_members_user_active` (`user_id`, `active`),
    CONSTRAINT `fk_project_members_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_project_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `chk_project_members_role` CHECK (`member_role` IN ('owner','editor','viewer'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill the legacy assignment table when that optional table exists.
SET @project_members_directory_sql = IF(
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='directory'),
    'INSERT IGNORE INTO project_members (project_id,user_id,member_role,active) SELECT project_id,user_id,''editor'',1 FROM directory',
    'SELECT 1'
);
PREPARE project_members_directory_stmt FROM @project_members_directory_sql;
EXECUTE project_members_directory_stmt;
DEALLOCATE PREPARE project_members_directory_stmt;

INSERT IGNORE INTO `project_members` (`project_id`, `user_id`, `member_role`, `active`)
SELECT `id`, `created_by`, 'owner', 1 FROM `projects` WHERE `created_by` IS NOT NULL;

INSERT IGNORE INTO `project_members` (`project_id`, `user_id`, `member_role`, `active`)
SELECT `id`, `assigned_user_id`, 'editor', 1 FROM `projects` WHERE `assigned_user_id` IS NOT NULL;
