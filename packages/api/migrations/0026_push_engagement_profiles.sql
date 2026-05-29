CREATE TABLE push_engagement_profiles (
  user_id TEXT PRIMARY KEY,
  median_click_latency_seconds INTEGER,
  tier TEXT NOT NULL DEFAULT 'unknown',
  avg_session_depth REAL,
  avg_origin_retention_percent REAL,
  campaigns_observed INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_push_engagement_profiles_tier ON push_engagement_profiles(tier);
