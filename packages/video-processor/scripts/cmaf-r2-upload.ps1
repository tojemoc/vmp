#!/usr/bin/env pwsh
<#!
.SYNOPSIS
  Package MP4 into HLS CMAF (and optional DASH), generate metadata.json,
  then upload processed outputs + metadata to Cloudflare R2 with rclone.

.EXAMPLE
  ./cmaf-r2-upload.ps1 -InputMp4 ./input.mp4 -VideoId vid_123 -RcloneRemote r2:my-bucket -WithDash
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputMp4,

  [Parameter(Mandatory = $true)]
  [string]$VideoId,

  [Parameter(Mandatory = $true)]
  [string]$RcloneRemote,

  [switch]$WithDash
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InputMp4 -PathType Leaf)) {
  throw "Input file not found: $InputMp4"
}

foreach ($cmd in @('ffmpeg', 'ffprobe', 'rclone')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd is required but was not found in PATH"
  }
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("vmp-cmaf-" + [Guid]::NewGuid().ToString('N'))
$outputRoot = Join-Path $workDir 'output'
$processedDir = Join-Path $outputRoot 'processed'
$hlsDir = Join-Path $processedDir 'hls'
$dashDir = Join-Path $processedDir 'dash'
$metadataPath = Join-Path $outputRoot 'metadata.json'

New-Item -ItemType Directory -Force -Path $hlsDir | Out-Null

try {
  Write-Host 'Packaging HLS CMAF...'
  $hlsSegmentPattern = (Join-Path $hlsDir '%v/segment_%05d.m4s').Replace('\\', '/')
  $hlsOutputPattern = (Join-Path $hlsDir '%v/index.m3u8').Replace('\\', '/')

  $hlsArgs = @(
    '-hide_banner', '-y',
    '-i', $InputMp4,
    '-filter_complex', '[0:v]split=3[v1080][v720][v480];[v1080]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v1080o];[v720]scale=w=1280:h=720:force_original_aspect_ratio=decrease[v720o];[v480]scale=w=854:h=480:force_original_aspect_ratio=decrease[v480o]',
    '-map', '[v1080o]', '-map', '0:a:0?',
    '-map', '[v720o]', '-map', '0:a:0?',
    '-map', '[v480o]', '-map', '0:a:0?',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-sc_threshold', '0', '-g', '48', '-keyint_min', '48',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-b:v:0', '5000k', '-maxrate:v:0', '5350k', '-bufsize:v:0', '7500k', '-b:a:0', '192k',
    '-b:v:1', '2800k', '-maxrate:v:1', '2996k', '-bufsize:v:1', '4200k', '-b:a:1', '128k',
    '-b:v:2', '1400k', '-maxrate:v:2', '1498k', '-bufsize:v:2', '2100k', '-b:a:2', '96k',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', $hlsSegmentPattern,
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', 'v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p',
    $hlsOutputPattern
  )

  & ffmpeg @hlsArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'ffmpeg HLS packaging failed'
  }

  if ($WithDash) {
    New-Item -ItemType Directory -Force -Path $dashDir | Out-Null
    Write-Host 'Packaging DASH...'
    $dashManifestPath = (Join-Path $dashDir 'manifest.mpd').Replace('\\', '/')

    $dashArgs = @(
      '-hide_banner', '-y',
      '-i', $InputMp4,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
      '-f', 'dash',
      '-seg_duration', '4',
      '-use_template', '1',
      '-use_timeline', '1',
      '-init_seg_name', 'init-$RepresentationID$.m4s',
      '-media_seg_name', 'chunk-$RepresentationID$-$Number%05d$.m4s',
      $dashManifestPath
    )

    & ffmpeg @dashArgs
    if ($LASTEXITCODE -ne 0) {
      throw 'ffmpeg DASH packaging failed'
    }
  }

  $sourceBaseName = [System.IO.Path]::GetFileName($InputMp4)
  $sourceKey = "videos/$VideoId/source/$sourceBaseName"
  $playlistKey = "videos/$VideoId/processed/hls/master.m3u8"
  $processedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')

  $durationRaw = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $InputMp4
  if ($LASTEXITCODE -ne 0) {
    throw 'ffprobe duration lookup failed'
  }
  $durationSeconds = [Math]::Round(([double]::Parse($durationRaw.Trim(), [System.Globalization.CultureInfo]::InvariantCulture)), 3)

  $segmentKeys = Get-ChildItem -LiteralPath $processedDir -Recurse -File |
    Where-Object { $_.Extension -in @('.m4s', '.mp4') } |
    Sort-Object FullName |
    ForEach-Object {
      $relative = $_.FullName.Substring($outputRoot.Length + 1).Replace('\\', '/')
      "videos/$VideoId/$relative"
    }

  $metadata = [ordered]@{
    videoId = $VideoId
    sourceKey = $sourceKey
    playlistKey = $playlistKey
    segmentKeys = $segmentKeys
    status = 'processed'
    visibility = 'private'
    processedAt = $processedAt
    segmentDurationSeconds = 4
    packaging = [ordered]@{
      hls = [ordered]@{
        masterPlaylistKey = $playlistKey
        variantPlaylistPattern = "videos/$VideoId/processed/hls/{rendition}/index.m3u8"
        segmentType = 'fmp4'
      }
    }
    durationSeconds = $durationSeconds
  }

  if ($WithDash) {
    $metadata.packaging.dash = [ordered]@{
      manifestKey = "videos/$VideoId/processed/dash/manifest.mpd"
    }
  }

  $metadata | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $metadataPath -NoNewline

  function Get-RemotePath([string]$remoteRoot, [string]$suffix) {
    if ($remoteRoot.EndsWith(':')) {
      return "$remoteRoot$suffix"
    }
    return ($remoteRoot.TrimEnd('/') + '/' + $suffix)
  }

  $processedRemote = Get-RemotePath $RcloneRemote "videos/$VideoId/processed/"
  $metadataRemote = Get-RemotePath $RcloneRemote "videos/$VideoId/metadata.json"

  Write-Host "Uploading processed tree to: $processedRemote"
  & rclone copy ((Join-Path $processedDir '').Replace('\\', '/')) $processedRemote --progress
  if ($LASTEXITCODE -ne 0) {
    throw 'rclone copy for processed output failed'
  }

  Write-Host "Uploading metadata to: $metadataRemote"
  & rclone copyto $metadataPath $metadataRemote --progress
  if ($LASTEXITCODE -ne 0) {
    throw 'rclone copyto for metadata failed'
  }

  Write-Host 'Done.'
  Write-Host "HLS master: videos/$VideoId/processed/hls/master.m3u8"
  if ($WithDash) {
    Write-Host "DASH manifest: videos/$VideoId/processed/dash/manifest.mpd"
  }
  Write-Host "Metadata: videos/$VideoId/metadata.json"
}
finally {
  if (Test-Path -LiteralPath $workDir) {
    Remove-Item -LiteralPath $workDir -Recurse -Force
  }
}
