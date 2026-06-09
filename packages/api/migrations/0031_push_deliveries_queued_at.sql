ALTER TABLE push_deliveries ADD COLUMN queued_at DATETIME;

CREATE INDEX idx_push_deliveries_pending_queue
  ON push_deliveries(status, scheduled_at, queued_at);
