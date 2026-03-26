@echo off
REM Upload generated HLS assets to Cloudflare R2 using app key structure.
REM Usage: upload-to-r2.bat local_dir bucket_name video_id

setlocal enabledelayedexpansion

set "LOCAL_DIR=%~1"
set "BUCKET=%~2"
set "VIDEO_ID=%~3"

if "%LOCAL_DIR%"=="" (
  echo Usage: %~nx0 local_dir bucket_name video_id
  exit /b 1
)

if "%BUCKET%"=="" (
  echo Usage: %~nx0 local_dir bucket_name video_id
  exit /b 1
)

if "%VIDEO_ID%"=="" (
  echo Usage: %~nx0 local_dir bucket_name video_id
  exit /b 1
)

if not exist "%LOCAL_DIR%" (
  echo Directory not found: %LOCAL_DIR%
  exit /b 1
)

set "DEST_PREFIX=videos/%VIDEO_ID%/processed"

for %%F in ("%LOCAL_DIR%\*") do (
  set "filename=%%~nxF"
  set "dest_key=!DEST_PREFIX!/!filename!"

  if /i "%%~xF"==".m3u8" (
    wrangler r2 object put "%BUCKET%/!dest_key!" --file="%%~fF" --content-type="application/vnd.apple.mpegurl"
  ) else if /i "%%~xF"==".ts" (
    wrangler r2 object put "%BUCKET%/!dest_key!" --file="%%~fF" --content-type="video/mp2t"
  ) else (
    wrangler r2 object put "%BUCKET%/!dest_key!" --file="%%~fF"
  )

  if errorlevel 1 exit /b 1
  echo Uploaded !filename! -^> !dest_key!
)

echo All files uploaded to %BUCKET%/%DEST_PREFIX%
