#!/bin/bash
# Create production-grade MPEG-TS HLS from an input video.
# Usage: ./create-hls.sh input.mp4 output_dir

set -euo pipefail

INPUT=${1:-}
OUTPUT_DIR=${2:-}

if [[ -z "$INPUT" || -z "$OUTPUT_DIR" ]]; then
  echo "Usage: $0 input.mp4 output_dir"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

ffmpeg -hide_banner -y \
  -i "$INPUT" \
  -c:v libx264 \
  -preset veryfast \
  -crf 22 \
  -c:a aac \
  -b:a 128k \
  -ar 48000 \
  -ac 2 \
  -f hls \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_flags independent_segments \
  -hls_segment_type mpegts \
  -hls_segment_filename "$OUTPUT_DIR/segment_%04d.ts" \
  "$OUTPUT_DIR/playlist.m3u8"

echo "HLS created at $OUTPUT_DIR/playlist.m3u8"
