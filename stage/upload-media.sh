#!/bin/sh
# Upload files from media/ to the R2 bucket "media" (served at https://media.freq.workers.dev/).
#   sh stage/upload-media.sh                      everything in media/
#   sh stage/upload-media.sh arca-c2c spc-neophon-2026   just these folders
# Files keep their media/ paths as keys. They're cached for a year, so a changed file should
# get a new name (e.g. talk-2.mp4) rather than overwrite, or visitors keep the old one.
# Needs `npx wrangler login` once per machine (the media Worker lives in ~/Desktop/projects/media-worker).
set -e
cd "$(dirname "$0")/../media"
for dir in "${@:-.}"; do find "$dir" -type f -not -name '.DS_Store'; done | sort -u | sed 's|^\./||' |
  xargs -P 6 -I{} sh -c '
    case "$1" in
      *.mp4) t=video/mp4;; *.avif) t=image/avif;; *.png) t=image/png;; *.jpg|*.jpeg) t=image/jpeg;;
      *.heic|*.HEIC) t=image/heic;; *.json) t=application/json;; *) t=application/octet-stream;;
    esac
    if npx -y wrangler@4.147.0 r2 object put "media/$1" --file "$1" --content-type "$t" --remote >/dev/null 2>&1
    then echo "ok      $1"; else echo "FAILED  $1"; fi' _ {}
