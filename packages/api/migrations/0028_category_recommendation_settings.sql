-- Per-category tuning for watch-page recommendations.
ALTER TABLE video_categories ADD COLUMN recommendation_recency_bias REAL NOT NULL DEFAULT 1.0;
ALTER TABLE video_categories ADD COLUMN recommendation_low_views_boost REAL NOT NULL DEFAULT 0.0;
ALTER TABLE video_categories ADD COLUMN recommendation_category_lock INTEGER NOT NULL DEFAULT 0;
