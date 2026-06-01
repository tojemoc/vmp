# Example probe output

This abbreviated example is from running the probe against the repository's
placeholder moq.dev endpoint/broadcast:

```bash
node packages/moq-probe/dist/index.js \
  --endpoint https://cdn.moq.dev/anon \
  --broadcast obstesting123 \
  --groups 1 \
  --frames-per-group 1 \
  --timeout-ms 5000 \
  --json
```

The endpoint accepted a connection through `@moq/net`'s WebSocket fallback, but
the placeholder broadcast did not expose a readable HANG or MSF catalog at the
time of the smoke test:

```json
{
  "endpoint": "https://cdn.moq.dev/anon",
  "broadcast": "obstesting123",
  "runtime": {
    "nodeVersion": "v22.22.3",
    "hasNativeWebTransport": false,
    "hasNativeWebSocket": true,
    "requiredQuicApisAvailable": false,
    "recommendedRuntime": "Node can run this probe only when the MoQ relay supports @moq/net qmux/WebSocket fallback. For true MoQ over QUIC, use a runtime with WebTransport support or a Rust/Go QUIC implementation."
  },
  "connection": {
    "ok": true,
    "protocolVersion": "moq-lite-02",
    "url": "https://cdn.moq.dev/anon"
  },
  "catalog": {
    "format": "none",
    "trackName": null,
    "error": "HANG catalog.json: Error: RESET_STREAM: 13; MSF catalog: Error: RESET_STREAM: 13",
    "tracks": []
  },
  "payloadFormat": "unknown: no media payloads observed",
  "recommendedRecorderDesign": "Build a reconstruction layer from catalog + object semantics before choosing R2 media layout."
}
```

Against an active broadcast with a readable catalog, the same report includes a
`tracks` array with per-track payload inspections:

```json
{
  "catalog": {
    "format": "hang",
    "trackName": "catalog.json",
    "tracks": [
      {
        "name": "video/720p",
        "mediaKind": "video",
        "codec": "avc1.640028",
        "container": { "kind": "cmaf", "timescale": 90000, "trackId": 1 }
      }
    ]
  },
  "tracks": [
    {
      "track": { "name": "video/720p" },
      "groupsObserved": 1,
      "framesObserved": 1,
      "groupMappingConclusion": "Evidence supports one MoQ group == one CMAF fragment.",
      "inspections": [
        {
          "trackName": "video/720p",
          "trackAlias": null,
          "subgroupId": null,
          "groupId": 1234,
          "frameId": 0,
          "payloadLength": 48213,
          "firstBytesHex": "00 00 00 18 73 74 79 70 ...",
          "signatures": ["styp", "moof", "mdat", "iso-bmff"],
          "cmaf": {
            "likely": true,
            "decodeTimestampUs": 41200000
          }
        }
      ]
    }
  ],
  "payloadFormat": "CMAF/fMP4 fragments",
  "recommendedRecorderDesign": "Persist init segments and moof+mdat fragments almost verbatim to R2; generate HLS manifests from segment metadata."
}
```

