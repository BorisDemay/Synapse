#!/usr/bin/env bash
set -euo pipefail

# Pull-based updater. Each instance runs this locally; no instance registry is
# required. Configuration is read from the instance environment file.
ROOT="${SYNAPSE_DEPLOY_ROOT:-/srv/synapse}"
ENV_FILE="${SYNAPSE_UPDATE_ENV_FILE:-$ROOT/.env}"
REPOSITORY="${SYNAPSE_UPDATE_REPOSITORY:-}"
API="${SYNAPSE_UPDATE_API:-https://api.github.com}"
TOKEN_FILE="${SYNAPSE_UPDATE_TOKEN_FILE:-$ROOT/.update-token}"
incoming="${SYNAPSE_DEPLOY_INCOMING:-$ROOT/incoming}"

if [[ -L "$ROOT" || ( -e "$ROOT" && ! -d "$ROOT" ) ]]; then
  echo "update deployment root is unsafe" >&2
  exit 1
fi
if [[ -L "$incoming" || ( -e "$incoming" && ! -d "$incoming" ) ]]; then
  echo "update incoming directory is unsafe" >&2
  exit 1
fi

[[ -r "$ENV_FILE" ]] || { echo "update environment is missing" >&2; exit 1; }
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "SYNAPSE_UPDATE_REPOSITORY must be owner/repository" >&2; exit 2;
}
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

# Only authentication lives in the shared array; each request sets its own
# Accept header so curl never sends two conflicting values.
headers=()
curl_config=""
tmp=""
cleanup() {
  rm -f "$tmp" "$curl_config"
}
trap cleanup EXIT

if [[ -r "$TOKEN_FILE" ]]; then
  token="$(tr -d '\r\n' < "$TOKEN_FILE")"
  [[ "$token" =~ ^(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$ ]] || { echo "invalid update token" >&2; exit 2; }
  curl_config="$(mktemp "${TMPDIR:-/tmp}/synapse-update-curl.XXXXXX")"
  chmod 0600 "$curl_config"
  printf 'header = "Authorization: Bearer %s"\n' "$token" > "$curl_config"
  unset token
  headers+=(--config "$curl_config")
fi

release="$(curl --fail --silent --show-error --max-time 20 "${headers[@]}" \
  -H 'Accept: application/vnd.github+json' "$API/repos/$REPOSITORY/releases/latest")"
tag="$(jq -er '.tag_name | strings | select(test("^v0\\.1\\.[0-9]+$"))' <<<"$release")"
version="${tag#v}"
asset_id="$(jq -er --arg name "synapse-$version.tar.gz" '.assets[] | select(.name == $name) | .id' <<<"$release")"
sha="$(jq -er '.target_commitish | strings | select(test("^[0-9a-f]{40,64}$"))' <<<"$release")"

active=""
[[ -f "$ROOT/.active-version" ]] && active="$(tr -d '\r\n' < "$ROOT/.active-version")"
if [[ "$active" == "$version" ]]; then
  exit 0
fi

install -d -m 0750 "$incoming"
archive="$incoming/synapse-$version.tar.gz"
tmp="$archive.part"
# Download through the asset API: fine-grained tokens get a 404 from the
# browser_download_url redirect even with Contents read-only permission.
curl --fail --silent --show-error --location --max-time 300 \
  "${headers[@]}" -H 'Accept: application/octet-stream' \
  "$API/repos/$REPOSITORY/releases/assets/$asset_id" --output "$tmp"
test -s "$tmp"
mv "$tmp" "$archive"
"${SYNAPSE_DEPLOY_COMMAND:-/usr/local/sbin/synapse-deploy}" "$version" "$sha"
