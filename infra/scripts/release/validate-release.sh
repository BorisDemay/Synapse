#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-}"
[[ -n "$ROOT" && -f "$ROOT/stable/latest.json" && -f "$ROOT/stable/web.json" ]] || exit 1
latest="$(jq -e . "$ROOT/stable/latest.json")"
web="$(jq -e . "$ROOT/stable/web.json")"
version="$(jq -er '.version | strings | select(test("^0\\.1\\.[0-9]+$"))' <<<"$latest")"
sha="$(jq -er '.commit_sha | strings | select(test("^[0-9a-f]{40,64}$"))' <<<"$latest")"
[[ "$(jq -er .version <<<"$web")" == "$version" ]] || exit 1
[[ "$(jq -er .commit_sha <<<"$web")" == "$sha" ]] || exit 1
for platform in linux-x86_64 windows-x86_64; do
  file="synapse-$platform.$([[ "$platform" == linux-x86_64 ]] && echo AppImage || echo exe)"
  jq -e --arg v "$version" --arg f "$file" \
    '.platforms[$platform].signature and (.platforms[$platform].url | startswith("https://")) and (.platforms[$platform].url | endswith("/updates/stable/" + $v + "/" + $f))' \
    --arg platform "$platform" <<<"$latest" >/dev/null
done
