CREATE TRIGGER IF NOT EXISTS cms_pages_set_updated_at
AFTER UPDATE ON cms_pages
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE cms_pages SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
