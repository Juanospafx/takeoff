-- Active project collaboration sessions. Rows are ephemeral and expire by last_seen.
CREATE TABLE IF NOT EXISTS `project_presence` (
    `project_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `client_id` VARCHAR(96) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `user_role` VARCHAR(32) NOT NULL,
    `last_seen` DATETIME(6) NOT NULL,
    PRIMARY KEY (`project_id`, `user_id`, `client_id`),
    KEY `idx_project_presence_active` (`project_id`, `last_seen`),
    CONSTRAINT `fk_project_presence_project`
        FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_project_presence_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

