-- ==============================================================================
-- MIGRATION: 20261009_won_project_outbox.sql
-- TARGET: MariaDB 10.11+ / MySQL 8.0+
-- PURPOSE: Additive transactional outbox for WonProject integration events.
-- CONTRACT: TASK-0058 (Outbox pattern with idempotency, backoff, and lease)
-- ==============================================================================
--
-- ARCHITECTURAL CONTEXT & DISPATCHER STRATEGY:
-- 1. Idempotency Guarantees:
--    - Single outbox entry per project event type via UNIQUE (`project_id`, `event_type`).
--    - Globally unique event identifier via UNIQUE (`event_id`) UUID.
--    - Exact payload integrity verified by `payload_hash` (SHA-256 hex digest).
--
-- 2. Dispatcher Concurrency & Lease Strategy:
--    - Workers query pending entries using index `idx_won_project_outbox_claim`:
--      WHERE status = 'pending'
--        AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
--        AND (locked_at IS NULL OR locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE))
--    - Safe worker claim options:
--      Option A (MariaDB 10.6+ / MySQL 8.0+ SKIP LOCKED):
--        SELECT id, event_id, project_id, event_type, payload, payload_hash, attempts
--        FROM won_project_outbox
--        WHERE status = 'pending'
--          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
--          AND (locked_at IS NULL OR locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE))
--        ORDER BY next_attempt_at ASC
--        LIMIT 50
--        FOR UPDATE SKIP LOCKED;
--      Option B (Atomic conditional lease acquisition):
--        UPDATE won_project_outbox
--        SET locked_at = CURRENT_TIMESTAMP,
--            locked_by = :worker_id,
--            lock_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)
--        WHERE status = 'pending'
--          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
--          AND (locked_at IS NULL OR locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE))
--        LIMIT 50;
--
-- 3. Backoff & Error Handling Strategy:
--    - On transient delivery failure:
--        attempts = attempts + 1
--        next_attempt_at = CURRENT_TIMESTAMP + INTERVAL (POW(2, attempts) * 30) SECOND
--        status = 'pending'
--        locked_at = NULL, locked_by = NULL, lock_expires_at = NULL
--    - On terminal failure (attempts >= max_attempts, e.g. 5):
--        status = 'failed'
--        next_attempt_at = NULL
--        locked_at = NULL, locked_by = NULL, lock_expires_at = NULL
--    - Error sanitization:
--        `last_error` must contain only sanitized diagnostic summaries (strip credentials,
--        bearer tokens, authorization headers, passwords, and sensitive PII).
--
-- 4. Rollback Strategy (Documented for operator manual execution if needed; do not execute automatically):
--    Rollback drops only the additive integration table (`won_project_outbox`) and never drops or
--    alters core project tables (`projects`).
--
--    ROLLBACK SCRIPT:
--    -- DROP TABLE IF EXISTS `won_project_outbox`;
-- ==============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `won_project_outbox` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` CHAR(36) NOT NULL COMMENT 'Unique UUID identifying the event instance',
    `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'FK to projects table',
    `event_type` VARCHAR(64) NOT NULL DEFAULT 'project.won' COMMENT 'Domain event identifier (e.g. project.won)',
    `payload` JSON NOT NULL COMMENT 'Exact serialized domain event JSON payload',
    `payload_hash` CHAR(64) NOT NULL COMMENT 'SHA-256 hexadecimal digest of payload for deduplication and integrity check',
    `status` ENUM('pending', 'delivered', 'failed') NOT NULL DEFAULT 'pending' COMMENT 'Event delivery lifecycle status',
    `attempts` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of delivery attempts executed',
    `next_attempt_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp for scheduling next dispatch attempt under backoff',
    `locked_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Timestamp when worker acquired lock lease',
    `locked_by` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Worker/dispatcher node identifier holding active lock lease',
    `lock_expires_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Lease expiration timestamp to prevent zombie locks',
    `last_error` TEXT NULL DEFAULT NULL COMMENT 'Sanitized error message from the most recent failed dispatch attempt',
    `delivered_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Timestamp when external recipient acknowledged receipt',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_won_project_outbox_event_id` (`event_id`),
    UNIQUE KEY `uq_won_project_outbox_project_event` (`project_id`, `event_type`),
    KEY `idx_won_project_outbox_claim` (`status`, `next_attempt_at`, `locked_at`),
    KEY `idx_won_project_outbox_status` (`status`),
    KEY `idx_won_project_outbox_project_id` (`project_id`),
    CONSTRAINT `fk_won_project_outbox_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Additive transactional outbox for WonProject events with lease and backoff';
