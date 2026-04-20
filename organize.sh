#!/usr/bin/env bash
# Run from ~/Downloads to sort loose files into category/year subfolders.

set -euo pipefail

DOWNLOADS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declare -A EXT_MAP=(
  [pdf]=Documents   [doc]=Documents   [docx]=Documents
  [xls]=Documents   [xlsx]=Documents  [ppt]=Documents
  [pptx]=Documents  [txt]=Documents   [md]=Documents
  [csv]=Documents   [odt]=Documents   [ods]=Documents

  [jpg]=Images      [jpeg]=Images     [png]=Images
  [gif]=Images      [bmp]=Images      [svg]=Images
  [webp]=Images     [tiff]=Images     [heic]=Images
  [raw]=Images

  [mp4]=Videos      [mkv]=Videos      [avi]=Videos
  [mov]=Videos      [wmv]=Videos      [flv]=Videos
  [webm]=Videos     [m4v]=Videos

  [mp3]=Audio       [wav]=Audio       [flac]=Audio
  [aac]=Audio       [ogg]=Audio       [m4a]=Audio
  [wma]=Audio

  [zip]=Archives    [tar]=Archives    [gz]=Archives
  [bz2]=Archives    [xz]=Archives     [rar]=Archives
  [7z]=Archives     [tgz]=Archives

  [deb]=Installers  [rpm]=Installers  [appimage]=Installers
  [exe]=Installers  [dmg]=Installers  [pkg]=Installers
  [msi]=Installers

  [py]=Code         [js]=Code         [ts]=Code
  [sh]=Code         [bash]=Code       [json]=Code
  [yaml]=Code       [yml]=Code        [toml]=Code
  [go]=Code         [rs]=Code         [c]=Code
  [cpp]=Code        [h]=Code
)

moved=0
skipped=0

while IFS= read -r -d '' file; do
  filename="$(basename "$file")"
  ext="${filename##*.}"
  ext_lower="${ext,,}"

  category="${EXT_MAP[$ext_lower]:-Misc}"
  year="$(date -r "$file" +%Y 2>/dev/null || date +%Y)"

  dest="$DOWNLOADS_DIR/$category/$year"
  mkdir -p "$dest"

  if [[ -e "$dest/$filename" ]]; then
    echo "SKIP (exists): $filename → $category/$year/"
    skipped=$((skipped + 1))
  else
    mv "$file" "$dest/$filename"
    echo "MOVED: $filename → $category/$year/"
    moved=$((moved + 1))
  fi
done < <(find "$DOWNLOADS_DIR" -maxdepth 1 -type f ! -name "organize.sh" ! -name ".*" -print0)

echo ""
echo "Done. Moved: $moved  Skipped (already exists): $skipped"
