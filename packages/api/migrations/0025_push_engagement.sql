CREATE TABLE push_campaigns (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  created_by_user_id TEXT,
  mode TEXT NOT NULL DEFAULT 'immediate',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE push_deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  scheduled_at DATETIME NOT NULL,
  sent_at DATETIME,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (campaign_id) REFERENCES push_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
);

CREATE TABLE push_clicks (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  click_latency_seconds INTEGER,
  FOREIGN KEY (delivery_id) REFERENCES push_deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES push_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE push_watch_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  user_id TEXT,
  origin_video_id TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  session_duration_seconds INTEGER,
  origin_max_retention_percent REAL,
  videos_watched_count INTEGER NOT NULL DEFAULT 1,
  other_videos_watched TEXT,
  outcome TEXT,
  FOREIGN KEY (campaign_id) REFERENCES push_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (delivery_id) REFERENCES push_deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (origin_video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX idx_push_deliveries_campaign ON push_deliveries(campaign_id);
CREATE INDEX idx_push_deliveries_status_scheduled ON push_deliveries(status, scheduled_at);
CREATE INDEX idx_push_clicks_campaign ON push_clicks(campaign_id);
CREATE INDEX idx_push_clicks_user ON push_clicks(user_id, clicked_at);
CREATE INDEX idx_push_watch_sessions_delivery ON push_watch_sessions(delivery_id);
