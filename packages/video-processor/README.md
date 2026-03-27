# Video Processor Admin (Cloudflare Pages)

Simple admin interface for:

- Drag-and-drop video uploads into Cloudflare R2 using the [tus resumable upload protocol](https://tus.io/).
- Triggering a control-plane processing action that validates packaged playback manifests and writes metadata.
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



## `/api/process` role

`POST /api/process` is a **control-plane** endpoint. It does not transcode media.

It validates packaged outputs in R2 and writes `videos/<videoId>/metadata.json` with packaging and rendition metadata. For production you should continue to generate HLS/DASH assets with `ffmpeg` (or your media pipeline) and upload those files under `videos/<videoId>/processed/`.

## Processing output

`POST /api/process` validates the presence of:

- Required HLS master playlist: `videos/:videoId/processed/hls/master.m3u8`
- Optional DASH manifest: `videos/:videoId/processed/dash/manifest.mpd`

Then it writes/updates `videos/:videoId/metadata.json` with:

- `packaging: "cmaf"`
- `hlsMasterKey`
- `dashManifestKey` (nullable)
- `variants`
- `audioGroups` (when present)
- `processedAt`, `visibility`, `status`
