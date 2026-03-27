# Video Processor Admin (Cloudflare Pages)

Simple admin interface for:

- Drag-and-drop video uploads into Cloudflare R2 using the [tus resumable upload protocol](https://tus.io/).
- Triggering processing logic in Cloudflare Pages Functions that writes `.ts` segment objects and an HLS playlist.
- Applying visibility tags (`private`, `unlisted`, `public`).
- Listing processed videos.

## Local development

```bash
npm run dev --workspace @vmp/video-processor
```

## Deploy

```bash
npm run deploy --workspace @vmp/video-processor
```

## Upload flow

- Client uses `tus-js-client` in the admin page.
- `POST /api/uploads` creates a multipart upload session in R2 and returns a tus upload URL.
- `PATCH /api/uploads/:videoId` appends chunks as multipart parts.
- `HEAD /api/uploads/:videoId` reports resumable offset.

## Required Cloudflare bindings

Set up an R2 bucket binding in `wrangler.toml`:

- `VIDEO_BUCKET`



## ⚠️ About current `/api/process` output

The Cloudflare Pages Function at `functions/api/process.js` currently slices source bytes into fixed-size chunks and stores them with a `.ts` extension. That shape is useful for testing object layout, but those files are **not guaranteed to be valid MPEG-TS segments** and can fail in strict HLS players.

For production, transcode with `ffmpeg` and upload the generated playlist + segments:

```bash
# 1) Generate valid HLS assets locally
./scripts/create-hls.sh ./input.mp4 ./tmp/hls

# 2) Upload to your R2 bucket under videos/<videoId>/processed
./scripts/upload-to-r2.sh ./tmp/hls <your-r2-bucket-binding-name> <videoId>
```

If you only need a preview rendition:

```bash
./scripts/create-preview.sh ./input.mp4 ./tmp/hls-preview 30
./scripts/upload-to-r2.sh ./tmp/hls-preview <your-r2-bucket-binding-name> <videoId>
```

Windows Command Prompt equivalents are also available:

```bat
.\scripts\create-hls.bat .\input.mp4 .\tmp\hls
.\scripts\create-preview.bat .\input.mp4 .\tmp\hls-preview 30
.\scripts\upload-to-r2.bat .\tmp\hls <your-r2-bucket-binding-name> <videoId>
```


For CMAF-first packaging (with optional DASH) and direct `rclone` upload to R2, use:

```bash
./scripts/cmaf-r2-upload.sh ./input.mp4 <videoId> <rclone-remote> [--with-dash]
```

PowerShell equivalent:

```powershell
./scripts/cmaf-r2-upload.ps1 -InputMp4 ./input.mp4 -VideoId <videoId> -RcloneRemote <rclone-remote> [-WithDash]
```


## Processing output

`POST /api/process` now emits:

- `videos/:videoId/processed/segments/segment_0000.ts` style segment objects
- `videos/:videoId/processed/playlist.m3u8` referencing those segment keys
- `videos/:videoId/metadata.json` including the generated `segmentKeys`

Processing reads the source object from R2 in ranged chunks to avoid loading the entire source file into worker memory.
