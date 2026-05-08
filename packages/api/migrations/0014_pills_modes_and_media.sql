ALTER TABLE pills ADD COLUMN value_mode TEXT NOT NULL DEFAULT 'number';
ALTER TABLE pills ADD COLUMN value_secondary REAL;
ALTER TABLE pills ADD COLUMN graph_embed_url TEXT;
ALTER TABLE pills ADD COLUMN graph_payload_json TEXT;
