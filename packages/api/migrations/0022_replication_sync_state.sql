CREATE TABLE IF NOT EXISTS replication_sync_state (
  stream_name TEXT PRIMARY KEY,
  cursor_value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
