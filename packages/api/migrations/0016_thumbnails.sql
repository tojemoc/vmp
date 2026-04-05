-- Migration 0016: Thumbnail upload feature marker.
--
-- thumbnail_url already exists in the videos table from the initial schema
-- (packages/api/migrations/0001_initial.sql). No new columns are needed.
--
-- This migration adds a covering index on thumbnail_url so that any future
-- query filtering or ordering by thumbnail presence (IS NULL / IS NOT NULL)
-- can be answered without a full table scan.
--
-- Run:
--   wrangler d1 execute video-subscription-db --file=./migrations/0016_thumbnails.sql

CREATE INDEX IF NOT EXISTS idx_videos_thumbnail ON videos (thumbnail_url);
