-- One managed PDF per catalog item. Files are stored outside the web root;
-- this table contains server-generated storage identifiers only.
CREATE TABLE IF NOT EXISTS catalog_item_attachments (
    catalog_item_id BIGINT UNSIGNED NOT NULL,
    storage_name CHAR(52) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(64) NOT NULL DEFAULT 'application/pdf',
    size_bytes BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) NOT NULL,
    uploaded_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (catalog_item_id),
    UNIQUE KEY uq_catalog_item_attachment_storage (storage_name),
    KEY idx_catalog_item_attachment_sha256 (sha256),
    CONSTRAINT fk_catalog_item_attachment_item FOREIGN KEY (catalog_item_id)
        REFERENCES catalog_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
