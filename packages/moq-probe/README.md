# @vmp/moq-probe

Standalone diagnostic probe for live MoQ broadcasts.

This is not a recorder. It does not upload to R2, generate manifests, create DVR
state, or touch the existing frontend/API routes. Its only job is to inspect a
live MoQ broadcast and report the media format being transported.

## Contents

- [Runtime findings](#runtime-findings)
- [Usage](#usage)
- [What it inspects](#what-it-inspects)
- [Known API limitation](#known-api-limitation)
- [Recorder recommendation matrix](#recorder-recommendation-matrix)
- [Related documentation](#related-documentation)

## Runtime findings

The current Cursor Cloud Node runtime reports:

- `globalThis.WebTransport`: unavailable
- `globalThis.WebSocket`: available
- `@moq/net`: usable, with qmux/WebSocket fallback when the relay supports it

That means this package can probe relays that expose the `@moq/net` WebSocket
fallback. It cannot validate native QUIC/WebTransport behavior from this Node
runtime. For true MoQ-over-QUIC probing when no WebSocket fallback exists, use a
runtime with WebTransport support or build the probe in Rust/Go against a QUIC
implementation.

## Usage

```bash
npm run probe --workspace=@vmp/moq-probe -- \
  --endpoint https://cdn.moq.dev/anon \
  --broadcast your-broadcast-name \
  --groups 3 \
  --frames-per-group 4
```

JSON output:

```bash
npm run probe --workspace=@vmp/moq-probe -- \
  --endpoint "$MOQ_ENDPOINT" \
  --broadcast "$MOQ_BROADCAST" \
  --json > moq-probe-report.json
```

Optional environment variables:

```text
MOQ_ENDPOINT
MOQ_BROADCAST
MOQ_CATALOG_FORMAT=auto|hang|msf
MOQ_PROBE_GROUPS=3
MOQ_PROBE_FRAMES_PER_GROUP=4
MOQ_PROBE_TIMEOUT_MS=10000
MOQ_WEBSOCKET_URL
MOQ_PROBE_DISABLE_WEBSOCKET=1
```

## What it inspects

- Connection/protocol version reported by `@moq/net`
- HANG catalog on `catalog.json`
- MSF catalog on `catalog`
- Track names, roles, codecs, containers, timescales, track IDs
- First N groups and frames per track
- Payload length and first bytes
- ISO-BMFF/CMAF box signatures: `ftyp`, `moov`, `moof`, `mdat`, `styp`
- Elementary stream signatures: Annex-B NAL, AAC ADTS, Ogg/Opus, WebM/EBML
- CMAF `tfdt` decode timestamps when catalog timescale is available
- HANG legacy leading-varint timestamps when catalog container is `legacy`

## Known API limitation

The high-level `@moq/net` `Track`/`Group` APIs expose group sequence and frame
sequence, but not IETF-level `trackAlias` or `subGroupId`. The probe reports
those fields as `not-exposed` unless the implementation is later moved to lower
level protocol hooks.

## Recorder recommendation matrix

| Probe result | Recorder recommendation |
| --- | --- |
| Payloads are CMAF/fMP4 (`moof` + `mdat`) | Persist init segments and fragments almost verbatim to R2; generate HLS manifests from segment metadata. |
| Payloads are raw elementary streams | Insert a packaging layer before R2 using ffmpeg/shaka-packager or an in-process CMAF muxer. |
| Payloads are custom/opaque | Build a reconstruction layer from catalog + object semantics before choosing a durable R2 media layout. |

The preferred final architecture remains:

```text
MoQ subscriber probe/recorder
  -> CMAF/fMP4 chunks
  -> R2
  -> HLS manifests generated from metadata
  -> Shaka-compatible playback
```

## Related documentation

| Document | Description |
| --- | --- |
| [Repository README](../../README.md) | Monorepo overview and documentation map |
| [packages/media-pipeline/README.md](../media-pipeline/README.md) | Current HLS encode + R2 upload pipeline on the media VM |
| [AGENTS.md](../../AGENTS.md) | Video access flow, R2 proxy, and platform architecture |
