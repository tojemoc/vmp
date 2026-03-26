@echo off
REM Create production-grade MPEG-TS HLS from an input video.
REM Usage: create-hls.bat input.mp4 output_dir

setlocal enabledelayedexpansion

set "INPUT=%~1"
set "OUTPUT_DIR=%~2"

if "%INPUT%"=="" (
  echo Usage: %~nx0 input.mp4 output_dir
  exit /b 1
)

if "%OUTPUT_DIR%"=="" (
  echo Usage: %~nx0 input.mp4 output_dir
  exit /b 1
)

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

ffmpeg -hide_banner -y ^
  -i "%INPUT%" ^
  -c:v libx264 ^
  -preset veryfast ^
  -crf 22 ^
  -c:a aac ^
  -b:a 128k ^
  -ar 48000 ^
  -ac 2 ^
  -f hls ^
  -hls_time 6 ^
  -hls_playlist_type vod ^
  -hls_flags independent_segments ^
  -hls_segment_type mpegts ^
  -hls_segment_filename "%OUTPUT_DIR%/segment_%%04d.ts" ^
  "%OUTPUT_DIR%/playlist.m3u8"

if errorlevel 1 exit /b 1

echo HLS created at %OUTPUT_DIR%/playlist.m3u8
