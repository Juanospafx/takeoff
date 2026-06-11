-- FIELD REPORT ATTACHMENTS MIGRATION
-- MySQL 8+
-- Adds support for report attachments with JSON fallback + normalized table.

START TRANSACTION;

-- 1) Add JSON metadata column to existing file_reports
ALTER TABLE file_reports
  ADD COLUMN IF NOT EXISTS attachments_json JSON NULL AFTER annotations_json;

-- 2) Create normalized attachment table with FK type matching file_reports.id
SET @id_col_type := (
  SELECT COLUMN_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'file_reports'
    AND COLUMN_NAME = 'id'
  LIMIT 1
);

SET @sql := CONCAT(
  'CREATE TABLE IF NOT EXISTS field_report_attachments (',
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,',
  'field_report_id ', IFNULL(@id_col_type, 'BIGINT UNSIGNED'), ' NOT NULL,',
  'original_name VARCHAR(255) NOT NULL,',
  'mime_type VARCHAR(191) NOT NULL,',
  'file_size BIGINT UNSIGNED NOT NULL,',
  'storage_path VARCHAR(1024) NOT NULL,',
  'public_url VARCHAR(1024) DEFAULT NULL,',
  'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  'PRIMARY KEY (id),',
  'KEY idx_fra_report (field_report_id),',
  'KEY idx_fra_created_at (created_at),',
  'CONSTRAINT fk_fra_report FOREIGN KEY (field_report_id) REFERENCES file_reports(id) ON DELETE CASCADE',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;

-- Optional verification:
-- SHOW CREATE TABLE file_reports;
-- SHOW CREATE TABLE field_report_attachments;
