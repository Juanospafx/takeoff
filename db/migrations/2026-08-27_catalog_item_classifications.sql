-- Additive Cost Catalog classifications used by the unified item editor.
DELIMITER $$
DROP PROCEDURE IF EXISTS catalog_phase6_add_column_if_missing$$
CREATE PROCEDURE catalog_phase6_add_column_if_missing(IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='catalog_items' AND column_name=p_column) THEN
        SET @catalog_phase6_sql=p_definition; PREPARE stmt FROM @catalog_phase6_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END$$
CALL catalog_phase6_add_column_if_missing('masterformat','ALTER TABLE catalog_items ADD COLUMN masterformat VARCHAR(100) NULL AFTER cost_code')$$
CALL catalog_phase6_add_column_if_missing('uniformat','ALTER TABLE catalog_items ADD COLUMN uniformat VARCHAR(100) NULL AFTER masterformat')$$
DROP PROCEDURE IF EXISTS catalog_phase6_add_column_if_missing$$
DELIMITER ;
