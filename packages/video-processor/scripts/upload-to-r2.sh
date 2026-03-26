#!/bin/bash
# Upload generated HLS assets to Cloudflare R2 using app key structure.
# Usage: ./upload-to-r2.sh local_dir bucket_name video_id

set -euo pipefail

LOCAL_DIR=${1:-}
BUCKET=${2:-}
VIDEO_ID=${3:-}

if [[ -z "$LOCAL_DIR" || -z "$BUCKET" || -z "$VIDEO_ID" ]]; then
  echo "Usage: $0 local_dir bucket_name video_id"
  exit 1
fi

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "Directory not found: $LOCAL_DIR"
  exit 1
fi

DEST_PREFIX="videos/$VIDEO_ID/processed"

for file in "$LOCAL_DIR"/*; do
  filename=$(basename "$file")
  dest_key="$DEST_PREFIX/$filename"

  if [[ "$filename" == *.m3u8 ]]; then
    wrangler r2 object put "$BUCKET/$dest_key" --file="$file" --content-type="application/vnd.apple.mpegurl"
  elif [[ "$filename" == *.ts ]]; then
    wrangler r2 object put "$BUCKET/$dest_key" --file="$file" --content-type="video/mp2t"
  else
    wrangler r2 object put "$BUCKET/$dest_key" --file="$file"
  fi

  echo "Uploaded $filename -> $dest_key"
done

echo "All files uploaded to $BUCKET/$DEST_PREFIX"
