-- Persist Bunny Stream library id per job so polling survives library config changes.
ALTER TABLE media_convert_jobs ADD COLUMN library_id TEXT;
