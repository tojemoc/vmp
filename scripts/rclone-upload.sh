#!/usr/bin/env bash
# scripts/rclone-upload.sh
#
# Uploads a processed video folder to the VMP R2 bucket.
#
# Usage:
#   ./scripts/rclone-upload.sh <local-processed-dir> <video-id>
#
# The <local-processed-dir> must contain a playlist.m3u8 and the HLS segment
# files produced by the video-processor package.  The files are uploaded to:
#   r2:vmp-videos/videos/<video-id>/processed/
#
# After upload the video will appear in GET /api/admin/videos as a draft with
# title "Untitled upload".  An editor must set the title, description, and
# publish status via the admin console before it becomes publicly visible.
#
# ── Thumbnail pipeline note ───────────────────────────────────────────────────
# If the video directory contains a metadata.json file with a "thumbnail" field
# pointing to a local JPEG, a future pipeline step could automatically upload it
# via:
#   POST /api/admin/videos/<video-id>/thumbnail   (multipart/form-data)
# This is NOT implemented here — manual upload through the admin UI
# (Admin → Videos → click the thumbnail cell) is the intended workflow for now.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

LOCAL_DIR="${1:?Usage: $0 <local-processed-dir> <video-id>}"
VIDEO_ID="${2:?Usage: $0 <local-processed-dir> <video-id>}"

REMOTE="r2:vmp-videos/videos/${VIDEO_ID}/processed"

echo "Uploading ${LOCAL_DIR} → ${REMOTE} …"
rclone copy --progress "${LOCAL_DIR}" "${REMOTE}"
echo "Done."
