#!/usr/bin/env bash
# Downloads the original LF2 v2.0a installer into the folder given ($1); checks its exact size.
set +e
out="$1"; mkdir -p "$out"
for url in \
  "https://lf2.net/LF2_v2.0a.exe" \
  "https://web.archive.org/web/20260921121026id_/https://lf2.net/LF2_v2.0a.exe" \
  "https://archive.org/download/little-fighter-2_202404/Little%20Fighter%202.rar/Little%20Fighter%202%2FLF2Setup.exe"; do
  echo "trying $url"
  curl -fL --retry 3 -o "$out/installer.exe" "$url" || continue
  size=$(wc -c < "$out/installer.exe" | tr -d ' ')
  echo "size $size"
  if [ "$size" = "29586263" ]; then mv "$out/installer.exe" "$out/LF2_v2.0a.exe"; exit 0; fi
  if [ "$size" = "31904750" ]; then mv "$out/installer.exe" "$out/lf2_v20a_Setup.exe"; exit 0; fi
  rm -f "$out/installer.exe"
done
echo "::error::could not download the LF2 v2.0a installer"
exit 1
