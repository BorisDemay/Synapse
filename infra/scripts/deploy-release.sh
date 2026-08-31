#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
COMMIT_SHA="${2:-}"
SYNAPSE_DEPLOY_ROOT="${SYNAPSE_DEPLOY_ROOT:-/mnt/nas1/synapse}"

[[ "$VERSION" =~ ^0\.1\.[0-9]+$ ]] || { echo "invalid release version" >&2; exit 2; }
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40,64}$ ]] || { echo "invalid commit SHA" >&2; exit 2; }

STAGE="$SYNAPSE_DEPLOY_ROOT/staging/$VERSION-$COMMIT_SHA"
if [[ ! -d "$STAGE" ]]; then
  INCOMING="${SYNAPSE_DEPLOY_INCOMING:-$SYNAPSE_DEPLOY_ROOT/incoming}/synapse-$VERSION.tar.gz"
  [[ -f "$INCOMING" ]] || { echo "staged release not found" >&2; exit 1; }
  if tar -tzf "$INCOMING" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "release archive contains an unsafe path" >&2
    exit 1
  fi
  install -d -m 0750 "$STAGE"
  tar -xzf "$INCOMING" -C "$STAGE" --no-same-owner --no-same-permissions
fi
[[ -d "$STAGE" ]] || { echo "staged release not found" >&2; exit 1; }
[[ "$(realpath "$STAGE")" == "$SYNAPSE_DEPLOY_ROOT/staging/$VERSION-$COMMIT_SHA" ]] || {
  echo "staging path escaped deployment root" >&2
  exit 1
}

(cd "$STAGE" && sha256sum --check SHA256SUMS)
node "$STAGE/validate-release.mjs" "$STAGE/release"

docker load --input "$STAGE/synapse-server-$VERSION.tar"
docker load --input "$STAGE/synapse-web-$VERSION.tar"
for image in "synapse-server:$VERSION" "synapse-web:$VERSION"; do
  test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")" = "$VERSION"
  test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$COMMIT_SHA"
done

PREVIOUS_VERSION=""
if [[ -f "$SYNAPSE_DEPLOY_ROOT/.active-version" ]]; then
  PREVIOUS_VERSION="$(tr -d '\r\n' < "$SYNAPSE_DEPLOY_ROOT/.active-version")"
fi

CURRENT_MIGRATIONS="$SYNAPSE_DEPLOY_ROOT/.migration-checksums"
if [[ ! -f "$CURRENT_MIGRATIONS" ]] || ! cmp -s "$CURRENT_MIGRATIONS" "$STAGE/migrations.sha256"; then
  bash "$SYNAPSE_DEPLOY_ROOT/infra/scripts/backup.sh" "$SYNAPSE_DEPLOY_ROOT/backups"
fi

RELEASES="$SYNAPSE_DEPLOY_ROOT/releases/stable"
install -d -m 0755 "$RELEASES"
if [[ ! -d "$RELEASES/$VERSION" ]]; then
  cp -a "$STAGE/release/stable/$VERSION" "$RELEASES/$VERSION.pending"
  mv "$RELEASES/$VERSION.pending" "$RELEASES/$VERSION"
fi

rollback() {
  local exit_code=$?
  if [[ $exit_code -ne 0 && -n "$PREVIOUS_VERSION" ]]; then
    SYNAPSE_VERSION="$PREVIOUS_VERSION" docker compose \
      -f "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml" \
      --env-file "$SYNAPSE_DEPLOY_ROOT/.env" up -d --no-build || true
  fi
  exit "$exit_code"
}
trap rollback EXIT

cp "$STAGE/docker-compose.yml" "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.next"
mv "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.next" "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml"
SYNAPSE_VERSION="$VERSION" SYNAPSE_COMMIT_SHA="$COMMIT_SHA" docker compose \
  -f "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml" \
  --env-file "$SYNAPSE_DEPLOY_ROOT/.env" up -d --no-build

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$SYNAPSE_DEPLOY_ROOT/.env" | tail -n 1
}
PUBLIC_URL="${SYNAPSE_PUBLIC_URL:-$(env_value SYNAPSE_PUBLIC_URL)}"
[[ "$PUBLIC_URL" =~ ^https:// ]] || { echo "SYNAPSE_PUBLIC_URL must use HTTPS" >&2; exit 1; }
HEALTH_URL="${SYNAPSE_HEALTH_URL:-$PUBLIC_URL/health/version}"
VERSION_JSON=""
WEB_JSON=""
for attempt in {1..30}; do
  VERSION_JSON="$(curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  WEB_JSON="$(curl --fail --silent --show-error --max-time 5 "$PUBLIC_URL/build.json" 2>/dev/null || true)"
  if printf '%s' "$VERSION_JSON" | grep -Fq "\"version\":\"$VERSION\"" \
    && printf '%s' "$VERSION_JSON" | grep -Fq "\"commit_sha\":\"$COMMIT_SHA\"" \
    && printf '%s' "$WEB_JSON" | grep -Fq "\"version\":\"$VERSION\"" \
    && printf '%s' "$WEB_JSON" | grep -Fq "\"commit_sha\":\"$COMMIT_SHA\""; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "deployed services did not report the expected release identity" >&2
    exit 1
  fi
  sleep 2
done
printf '%s' "$VERSION_JSON" | grep -Fq "\"version\":\"$VERSION\""
printf '%s' "$VERSION_JSON" | grep -Fq "\"commit_sha\":\"$COMMIT_SHA\""
printf '%s' "$WEB_JSON" | grep -Fq "\"version\":\"$VERSION\""
printf '%s' "$WEB_JSON" | grep -Fq "\"commit_sha\":\"$COMMIT_SHA\""
for artifact in synapse-linux-x86_64.AppImage synapse-windows-x86_64.exe; do
  curl --fail --silent --show-error --max-time 30 \
    "$PUBLIC_URL/updates/stable/$VERSION/$artifact" --output /dev/null
done

# Mutable discovery metadata is the activation switch and is replaced last.
cp "$STAGE/release/stable/latest.json" "$RELEASES/latest.json.next"
cp "$STAGE/release/stable/web.json" "$RELEASES/web.json.next"
mv "$RELEASES/latest.json.next" "$RELEASES/latest.json"
mv "$RELEASES/web.json.next" "$RELEASES/web.json"
cp "$STAGE/migrations.sha256" "$CURRENT_MIGRATIONS.next"
mv "$CURRENT_MIGRATIONS.next" "$CURRENT_MIGRATIONS"
printf '%s\n' "$VERSION" > "$SYNAPSE_DEPLOY_ROOT/.active-version.next"
mv "$SYNAPSE_DEPLOY_ROOT/.active-version.next" "$SYNAPSE_DEPLOY_ROOT/.active-version"
trap - EXIT
