#!/usr/bin/env bash
# Package MP4 into HLS CMAF (and optional DASH), generate metadata.json,
# then upload processed outputs + metadata to Cloudflare R2 with rclone.
#
# Usage:
#   ./cmaf-r2-upload.sh <input.mp4> <videoId> <rclone_remote> [--with-dash]
#
# Example:
#   ./cmaf-r2-upload.sh ./input.mp4 vid_123 r2:my-bucket --with-dash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: cmaf-r2-upload.sh <input.mp4> <videoId> <rclone_remote> [--with-dash]

Arguments:
  input.mp4       Path to input MP4 file.
  videoId         Video identifier used in object keys.
  rclone_remote   rclone destination root for the bucket (e.g. r2:my-bucket
                  or :s3,provider=Cloudflare,env_auth=true:my-bucket).

Options:
  --with-dash     Also package DASH at processed/dash/manifest.mpd.
  -h, --help      Show this help message.
USAGE
}

WITH_DASH=0
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-dash)
      WITH_DASH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ne 3 ]]; then
  usage
  exit 1
fi

INPUT_MP4=${POSITIONAL[0]}
VIDEO_ID=${POSITIONAL[1]}
RCLONE_REMOTE=${POSITIONAL[2]}

if [[ ! -f "$INPUT_MP4" ]]; then
  echo "Input file not found: $INPUT_MP4"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but not found in PATH"
  exit 1
fi

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe is required but not found in PATH"
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is required but not found in PATH"
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

OUTPUT_ROOT="$WORK_DIR/output"
PROCESSED_DIR="$OUTPUT_ROOT/processed"
HLS_DIR="$PROCESSED_DIR/hls"
DASH_DIR="$PROCESSED_DIR/dash"
METADATA_PATH="$OUTPUT_ROOT/metadata.json"

mkdir -p "$HLS_DIR"

echo "Packaging HLS CMAF..."
ffmpeg -hide_banner -y \
  -i "$INPUT_MP4" \
  -filter_complex "[0:v]split=3[v1080][v720][v480];[v1080]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v1080o];[v720]scale=w=1280:h=720:force_original_aspect_ratio=decrease[v720o];[v480]scale=w=854:h=480:force_original_aspect_ratio=decrease[v480o]" \
  -map "[v1080o]" -map 0:a:0? \
  -map "[v720o]" -map 0:a:0? \
  -map "[v480o]" -map 0:a:0? \
  -c:v libx264 -profile:v high -preset veryfast -sc_threshold 0 -g 48 -keyint_min 48 \
  -c:a aac -ar 48000 -ac 2 \
  -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k -b:a:0 192k \
  -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k -b:a:1 128k \
  -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k -b:a:2 96k \
  -f hls \
  -hls_time 4 \
  -hls_playlist_type vod \
  -hls_flags independent_segments \
  -hls_segment_type fmp4 \
  -hls_fmp4_init_filename "init.mp4" \
  -hls_segment_filename "$HLS_DIR/%v/segment_%05d.m4s" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p" \
  "$HLS_DIR/%v/index.m3u8"

if [[ $WITH_DASH -eq 1 ]]; then
  mkdir -p "$DASH_DIR"
  echo "Packaging DASH..."
  ffmpeg -hide_banner -y \
    -i "$INPUT_MP4" \
    -map 0:v:0 -map 0:a:0? \
    -c:v libx264 -preset veryfast -profile:v main -g 48 -keyint_min 48 -sc_threshold 0 \
    -c:a aac -ar 48000 -ac 2 -b:a 128k \
    -f dash \
    -seg_duration 4 \
    -use_template 1 \
    -use_timeline 1 \
    -init_seg_name 'init-$RepresentationID$.m4s' \
    -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' \
    "$DASH_DIR/manifest.mpd"
fi

SOURCE_BASENAME="$(basename "$INPUT_MP4")"
SOURCE_KEY="videos/$VIDEO_ID/source/$SOURCE_BASENAME"
PLAYLIST_KEY="videos/$VIDEO_ID/processed/hls/master.m3u8"
PROCESSED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DURATION_SECONDS="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_MP4" | awk '{printf "%.3f", $1}')"

SEGMENT_LIST="$WORK_DIR/segment-keys.txt"
find "$PROCESSED_DIR" -type f \( -name '*.m4s' -o -name '*.mp4' \) | sort | while read -r file; do
  rel="${file#"$OUTPUT_ROOT/"}"
  printf 'videos/%s/%s\n' "$VIDEO_ID" "$rel"
done > "$SEGMENT_LIST"

python3 - <<'PY' "$VIDEO_ID" "$SOURCE_KEY" "$PLAYLIST_KEY" "$PROCESSED_AT" "$DURATION_SECONDS" "$WITH_DASH" "$SEGMENT_LIST" "$METADATA_PATH"
import json
import pathlib
import sys

video_id, source_key, playlist_key, processed_at, duration_seconds, with_dash, segment_file, output_path = sys.argv[1:]
segment_keys = [line.strip() for line in pathlib.Path(segment_file).read_text().splitlines() if line.strip()]

metadata = {
    "videoId": video_id,
    "sourceKey": source_key,
    "playlistKey": playlist_key,
    "segmentKeys": segment_keys,
    "status": "processed",
    "visibility": "private",
    "processedAt": processed_at,
    "segmentDurationSeconds": 4,
    "packaging": {
        "hls": {
            "masterPlaylistKey": playlist_key,
            "variantPlaylistPattern": f"videos/{video_id}/processed/hls/{{rendition}}/index.m3u8",
            "segmentType": "fmp4",
        }
    },
    "durationSeconds": float(duration_seconds) if duration_seconds else None,
}

if with_dash == "1":
    metadata["packaging"]["dash"] = {
        "manifestKey": f"videos/{video_id}/processed/dash/manifest.mpd"
    }

pathlib.Path(output_path).write_text(json.dumps(metadata, indent=2) + "\n")
PY

build_remote_path() {
  local remote="$1"
  local suffix="videos/$VIDEO_ID/processed/"
  if [[ "$remote" == *":" ]]; then
    printf '%s%s' "$remote" "$suffix"
  else
    printf '%s/%s' "${remote%/}" "$suffix"
  fi
}

PROCESSED_REMOTE="$(build_remote_path "$RCLONE_REMOTE")"
METADATA_REMOTE="$(build_remote_path "$RCLONE_REMOTE")"
METADATA_REMOTE="${METADATA_REMOTE%processed/}metadata.json"

echo "Uploading processed tree to: $PROCESSED_REMOTE"
rclone copy "$PROCESSED_DIR/" "$PROCESSED_REMOTE" --progress

echo "Uploading metadata to: $METADATA_REMOTE"
rclone copyto "$METADATA_PATH" "$METADATA_REMOTE" --progress

echo "Done."
echo "HLS master: videos/$VIDEO_ID/processed/hls/master.m3u8"
if [[ $WITH_DASH -eq 1 ]]; then
  echo "DASH manifest: videos/$VIDEO_ID/processed/dash/manifest.mpd"
fi
echo "Metadata: videos/$VIDEO_ID/metadata.json"
