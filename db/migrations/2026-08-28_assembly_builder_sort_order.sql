-- Persist component order without changing existing assembly semantics.
DROP PROCEDURE IF EXISTS assembly_builder_add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE assembly_builder_add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_sql TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column) THEN
    SET @ddl=p_sql; PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;
CALL assembly_builder_add_column_if_missing('assembly_parts','sort_order','ALTER TABLE assembly_parts ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER waste_factor_percent');
DROP PROCEDURE IF EXISTS assembly_builder_add_column_if_missing;
