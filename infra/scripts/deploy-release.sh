#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
COMMIT_SHA="${2:-}"
SYNAPSE_DEPLOY_ROOT="${SYNAPSE_DEPLOY_ROOT:-/srv/synapse}"
ARCHIVE_SNAPSHOT=""

archive_snapshot_cleanup() {
  if [[ -n "$ARCHIVE_SNAPSHOT" ]]; then
    rm -f -- "$ARCHIVE_SNAPSHOT"
  fi
}

trap archive_snapshot_cleanup EXIT

[[ "$VERSION" =~ ^0\.1\.[0-9]+$ ]] || { echo "invalid release version" >&2; exit 2; }
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40,64}$ ]] || { echo "invalid commit SHA" >&2; exit 2; }

if [[ -L "$SYNAPSE_DEPLOY_ROOT" ]]; then
  echo "deployment root must not be a symlink" >&2
  exit 1
fi
if [[ -e "$SYNAPSE_DEPLOY_ROOT" && ! -d "$SYNAPSE_DEPLOY_ROOT" ]]; then
  echo "deployment root path must be a directory" >&2
  exit 1
fi

STAGING_PARENT="$SYNAPSE_DEPLOY_ROOT/staging"
if [[ -L "$STAGING_PARENT" ]]; then
  echo "staging parent directory must not be a symlink" >&2
  exit 1
fi
if [[ -e "$STAGING_PARENT" && ! -d "$STAGING_PARENT" ]]; then
  echo "staging parent path must be a directory" >&2
  exit 1
fi

RELEASES_PARENT="$SYNAPSE_DEPLOY_ROOT/releases"
if [[ -L "$RELEASES_PARENT" ]]; then
  echo "releases parent directory must not be a symlink" >&2
  exit 1
fi
if [[ -e "$RELEASES_PARENT" && ! -d "$RELEASES_PARENT" ]]; then
  echo "releases parent path must be a directory" >&2
  exit 1
fi
RELEASES="$RELEASES_PARENT/stable"
if [[ -L "$RELEASES" ]]; then
  echo "stable releases directory must not be a symlink" >&2
  exit 1
fi
if [[ -e "$RELEASES" && ! -d "$RELEASES" ]]; then
  echo "stable releases path must be a directory" >&2
  exit 1
fi
if [[ -L "$RELEASES/$VERSION" ]]; then
  echo "stable release path must not be a symlink" >&2
  exit 1
fi
if [[ -e "$RELEASES/$VERSION" && ! -d "$RELEASES/$VERSION" ]]; then
  echo "stable release path must be a directory" >&2
  exit 1
fi
if [[ -d "$RELEASES/$VERSION" ]]; then
  echo "stable release directory already exists" >&2
  exit 1
fi

STAGE="$STAGING_PARENT/$VERSION-$COMMIT_SHA"
if [[ ! -d "$STAGE" ]]; then
  if [[ -n "${SYNAPSE_DEPLOY_INCOMING:-}" ]]; then
    INCOMING_PARENT="$SYNAPSE_DEPLOY_INCOMING"
    INCOMING_ARCHIVE_DESCRIPTION="configured incoming archive"
    INCOMING_PARENT_DIRECTORY_DESCRIPTION="configured incoming directory"
    INCOMING_PARENT_PATH_DESCRIPTION="configured incoming path"
  else
    INCOMING_PARENT="$SYNAPSE_DEPLOY_ROOT/incoming"
    INCOMING_ARCHIVE_DESCRIPTION="default incoming archive"
    INCOMING_PARENT_DIRECTORY_DESCRIPTION="incoming parent directory"
    INCOMING_PARENT_PATH_DESCRIPTION="incoming parent path"
  fi
  if [[ -L "$INCOMING_PARENT" ]]; then
    echo "$INCOMING_PARENT_DIRECTORY_DESCRIPTION must not be a symlink" >&2
    exit 1
  fi
  if [[ -e "$INCOMING_PARENT" && ! -d "$INCOMING_PARENT" ]]; then
    echo "$INCOMING_PARENT_PATH_DESCRIPTION must be a directory" >&2
    exit 1
  fi
  INCOMING="$INCOMING_PARENT/synapse-$VERSION.tar.gz"
  if [[ -L "$INCOMING" ]]; then
    echo "$INCOMING_ARCHIVE_DESCRIPTION must not be a symlink" >&2
    exit 1
  fi
  [[ -f "$INCOMING" ]] || { echo "staged release not found" >&2; exit 1; }
  if [[ -L "$INCOMING_PARENT" ]]; then
    echo "$INCOMING_PARENT_DIRECTORY_DESCRIPTION must not be a symlink" >&2
    exit 1
  fi
  if [[ -e "$INCOMING_PARENT" && ! -d "$INCOMING_PARENT" ]]; then
    echo "$INCOMING_PARENT_PATH_DESCRIPTION must be a directory" >&2
    exit 1
  fi
  if [[ -L "$INCOMING" ]]; then
    echo "$INCOMING_ARCHIVE_DESCRIPTION must not be a symlink" >&2
    exit 1
  fi
  read -r INCOMING_DEVICE INCOMING_INODE INCOMING_LINKS <<<"$(stat -c '%d %i %h' "$INCOMING")"
  if [[ "$INCOMING_LINKS" != 1 ]]; then
    echo "$INCOMING_ARCHIVE_DESCRIPTION must not be linked" >&2
    exit 1
  fi
  install -d -m 0750 "$STAGING_PARENT"
  ARCHIVE_SNAPSHOT="$(mktemp "$STAGING_PARENT/.archive-snapshot.XXXXXXXX")"
  cp --no-dereference -- "$INCOMING" "$ARCHIVE_SNAPSHOT"
  if [[ -L "$INCOMING" ]]; then
    echo "release archive changed during capture" >&2
    exit 1
  fi
  if [[ "$(stat -c '%d %i %h' "$INCOMING")" != "$INCOMING_DEVICE $INCOMING_INODE $INCOMING_LINKS" ]]; then
    echo "release archive changed during capture" >&2
    exit 1
  fi
  if [[ -L "$ARCHIVE_SNAPSHOT" || ! -f "$ARCHIVE_SNAPSHOT" ]]; then
    echo "release archive snapshot must be a regular file" >&2
    exit 1
  fi
  if [[ "$(stat -c %h "$ARCHIVE_SNAPSHOT")" != 1 ]]; then
    echo "release archive snapshot must not be linked" >&2
    exit 1
  fi
  ARCHIVE_PATHS="$(tar -tzf "$ARCHIVE_SNAPSHOT")" || {
    echo "failed to inspect release archive" >&2
    exit 1
  }
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$ARCHIVE_PATHS"; then
    echo "release archive contains an unsafe path" >&2
    exit 1
  fi
  ARCHIVE_VERBOSE_LISTING="$(tar -tzvf "$ARCHIVE_SNAPSHOT")" || {
    echo "failed to inspect release archive" >&2
    exit 1
  }
  if grep -Eq '^[lh]' <<<"$ARCHIVE_VERBOSE_LISTING"; then
    echo "release archive must not contain symlink or hardlink entries" >&2
    exit 1
  fi
  # GNU tar's verbose listing prefixes regular files with '-' and directories
  # with 'd'. Reject every other entry type before creating the staging path.
  if grep -Eq '^[^-d]' <<<"$ARCHIVE_VERBOSE_LISTING"; then
    echo "release archive contains unsupported entry type" >&2
    exit 1
  fi
  if [[ -L "$STAGING_PARENT" ]]; then
    echo "staging parent directory must not be a symlink" >&2
    exit 1
  fi
  if [[ -e "$STAGING_PARENT" && ! -d "$STAGING_PARENT" ]]; then
    echo "staging parent path must be a directory" >&2
    exit 1
  fi
  install -d -m 0750 "$STAGE"
  tar -xzf "$ARCHIVE_SNAPSHOT" -C "$STAGE" --no-same-owner --no-same-permissions
  archive_snapshot_cleanup
  ARCHIVE_SNAPSHOT=""
fi
[[ -d "$STAGE" ]] || { echo "staged release not found" >&2; exit 1; }
[[ "$(realpath "$STAGE")" == "$SYNAPSE_DEPLOY_ROOT/staging/$VERSION-$COMMIT_SHA" ]] || {
  echo "staging path escaped deployment root" >&2
  exit 1
}

if [[ -L "$STAGE/SHA256SUMS" ]]; then
  echo "staged checksum manifest must not be a symlink" >&2
  exit 1
fi

if [[ -L "$STAGE/SHA256SUMS" ]]; then
  echo "staged checksum manifest must not be a symlink" >&2
  exit 1
fi
(cd "$STAGE" && sha256sum --check SHA256SUMS)
if [[ -L "$STAGE/migrations.sha256" ]]; then
  echo "staged migrations checksum must not be a symlink" >&2
  exit 1
fi
if [[ -L "$STAGE/release" ]]; then
  echo "staged release directory must not be a symlink" >&2
  exit 1
fi
STAGED_RELEASE_SYMLINK="$(find -P "$STAGE/release" -type l -print -quit)" || {
  echo "failed to inspect staged release contents" >&2
  exit 1
}
if [[ -n "$STAGED_RELEASE_SYMLINK" ]]; then
  echo "staged release content must not contain a symlink" >&2
  exit 1
fi
if command -v node >/dev/null 2>&1; then
  if [[ -L "$STAGE/validate-release.mjs" ]]; then
    echo "staged validator must not be a symlink" >&2
    exit 1
  fi
  node "$STAGE/validate-release.mjs" "$STAGE/release"
else
  bash "$SYNAPSE_DEPLOY_ROOT/infra/scripts/release/validate-release.sh" "$STAGE/release"
fi
if [[ -L "$STAGE/synapse-server-$VERSION.tar" ]]; then
  echo "staged server image archive must not be a symlink" >&2
  exit 1
fi
if [[ -L "$STAGE/synapse-web-$VERSION.tar" ]]; then
  echo "staged web image archive must not be a symlink" >&2
  exit 1
fi
DEPLOY_COMPOSE="$STAGE/docker-compose.deploy.yml"
if [[ -L "$DEPLOY_COMPOSE" ]]; then
  echo "staged deployment compose must not be a symlink" >&2
  exit 1
fi
sed -E \
  -e "s#^([[:space:]]*image:[[:space:]]*synapse-server:).*#\\1$VERSION#" \
  -e "s#^([[:space:]]*image:[[:space:]]*synapse-web:).*#\\1$VERSION#" \
  "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml" > "$DEPLOY_COMPOSE"
python3 "$SYNAPSE_DEPLOY_ROOT/infra/scripts/check-deployment-layout.py" \
  "$SYNAPSE_DEPLOY_ROOT/.env" \
  "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml" "$DEPLOY_COMPOSE"

docker load --input "$STAGE/synapse-server-$VERSION.tar"
docker load --input "$STAGE/synapse-web-$VERSION.tar"
for image in "synapse-server:$VERSION" "synapse-web:$VERSION"; do
  test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")" = "$VERSION"
  test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$COMMIT_SHA"
done

PREVIOUS_VERSION=""
if [[ -L "$RELEASES/current" ]]; then
  PREVIOUS_VERSION="$(readlink "$RELEASES/current")"
elif [[ -f "$SYNAPSE_DEPLOY_ROOT/.active-version" ]]; then
  PREVIOUS_VERSION="$(tr -d '\r\n' < "$SYNAPSE_DEPLOY_ROOT/.active-version")"
fi
[[ -z "$PREVIOUS_VERSION" || "$PREVIOUS_VERSION" =~ ^0\.1\.[0-9]+$ ]] || {
  echo "invalid active release pointer" >&2
  exit 1
}

CURRENT_MIGRATIONS="$SYNAPSE_DEPLOY_ROOT/.migration-checksums"
if [[ ! -f "$CURRENT_MIGRATIONS" ]] || ! cmp -s "$CURRENT_MIGRATIONS" "$STAGE/migrations.sha256"; then
  ENV_FILE="$SYNAPSE_DEPLOY_ROOT/.env" bash "$SYNAPSE_DEPLOY_ROOT/infra/scripts/backup.sh" "$SYNAPSE_DEPLOY_ROOT/backups"
fi

if [[ -L "$SYNAPSE_DEPLOY_ROOT" ]]; then
  echo "deployment root must not be a symlink" >&2
  exit 1
fi
if [[ -e "$SYNAPSE_DEPLOY_ROOT" && ! -d "$SYNAPSE_DEPLOY_ROOT" ]]; then
  echo "deployment root path must be a directory" >&2
  exit 1
fi
if [[ -L "$RELEASES_PARENT" ]]; then
  echo "releases parent directory must not be a symlink" >&2
  exit 1
fi
if [[ -e "$RELEASES_PARENT" && ! -d "$RELEASES_PARENT" ]]; then
  echo "releases parent path must be a directory" >&2
  exit 1
fi
if [[ -L "$RELEASES" ]]; then
  echo "stable releases directory must not be a symlink" >&2
  exit 1
fi
if [[ -e "$RELEASES" && ! -d "$RELEASES" ]]; then
  echo "stable releases path must be a directory" >&2
  exit 1
fi
install -d -m 0755 "$RELEASES"
if [[ -e "$RELEASES/$VERSION" || -L "$RELEASES/$VERSION" ]]; then
  echo "stable release path appeared during deployment" >&2
  exit 1
fi
[[ ! -e "$RELEASES/$VERSION.pending" && ! -L "$RELEASES/$VERSION.pending" ]] || {
  echo "incomplete pending release exists" >&2
  exit 1
}
cp -a "$STAGE/release/stable/$VERSION" "$RELEASES/$VERSION.pending"
cp "$STAGE/release/stable/latest.json" "$RELEASES/$VERSION.pending/latest.json"
cp "$STAGE/release/stable/web.json" "$RELEASES/$VERSION.pending/web.json"
mv "$RELEASES/$VERSION.pending" "$RELEASES/$VERSION"
test -f "$RELEASES/$VERSION/latest.json"
test -f "$RELEASES/$VERSION/web.json"

CURRENT_ACTIVATED=false

rollback() {
  local exit_code=$?
  archive_snapshot_cleanup
  ARCHIVE_SNAPSHOT=""
  if [[ $exit_code -ne 0 && -n "$PREVIOUS_VERSION" ]]; then
    if [[ -f "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.rollback" ]]; then
      mv "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.rollback" "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml"
    fi
    SYNAPSE_VERSION="$PREVIOUS_VERSION" docker compose \
      -f "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml" \
      --env-file "$SYNAPSE_DEPLOY_ROOT/.env" up -d --no-build || true
    if [[ "$CURRENT_ACTIVATED" == true ]]; then
      if [[ -e "$RELEASES/current.rollback" || -L "$RELEASES/current.rollback" ]]; then
        if [[ ! -L "$RELEASES/current.rollback" && ! -f "$RELEASES/current.rollback" ]]; then
          echo "unexpected rollback pointer" >&2
          local restore_pointer="$RELEASES/current.restore.$BASHPID.$RANDOM"
          while [[ -e "$restore_pointer" || -L "$restore_pointer" ]]; do
            restore_pointer="$RELEASES/current.restore.$BASHPID.$RANDOM"
          done
          ln -s "$PREVIOUS_VERSION" "$restore_pointer"
          mv -T "$restore_pointer" "$RELEASES/current"
        else
          rm -f -- "$RELEASES/current.rollback"
          ln -s "$PREVIOUS_VERSION" "$RELEASES/current.rollback"
          mv -T "$RELEASES/current.rollback" "$RELEASES/current"
        fi
      else
        ln -s "$PREVIOUS_VERSION" "$RELEASES/current.rollback"
        mv -T "$RELEASES/current.rollback" "$RELEASES/current"
      fi
    fi
    printf '%s\n' "$PREVIOUS_VERSION" > "$SYNAPSE_DEPLOY_ROOT/.active-version.rollback"
    mv "$SYNAPSE_DEPLOY_ROOT/.active-version.rollback" "$SYNAPSE_DEPLOY_ROOT/.active-version"
  fi
  exit "$exit_code"
}
trap rollback EXIT

if [[ -n "$PREVIOUS_VERSION" ]]; then
  cp "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml" "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.rollback.next"
  mv "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.rollback.next" "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.rollback"
fi
cp "$DEPLOY_COMPOSE" "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.next"
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
# The health endpoint, the web build identity and both stable manifests must
# expose one version and one commit SHA. The health checks run before
# activation; the manifests are only reachable through the release pointer, so
# they are re-verified after activation while rollback is still armed.
served_identity() {
  local description="$1" url="$2" payload
  payload="$(curl --fail --silent --show-error --max-time 5 "$url" 2>/dev/null || true)"
  if [[ -z "$payload" ]]; then
    echo "$description is unavailable" >&2
    return 1
  fi
  if ! printf '%s' "$payload" | python3 -c '
import json
import sys

version, sha = sys.argv[1:3]
try:
    document = json.load(sys.stdin)
except ValueError:
    raise SystemExit("served release manifest is not valid JSON")
if document.get("version") != version or document.get("commit_sha") != sha:
    raise SystemExit("served release manifest identity diverged")
' "$VERSION" "$COMMIT_SHA"; then
    echo "$description does not expose the deployed identity" >&2
    return 1
  fi
}
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

cp "$STAGE/migrations.sha256" "$CURRENT_MIGRATIONS.next"
mv "$CURRENT_MIGRATIONS.next" "$CURRENT_MIGRATIONS"
printf '%s\n' "$VERSION" > "$SYNAPSE_DEPLOY_ROOT/.active-version.next"
mv "$SYNAPSE_DEPLOY_ROOT/.active-version.next" "$SYNAPSE_DEPLOY_ROOT/.active-version"
# Both discovery URLs resolve through this one pointer, so no mixed identity is exposed.
if [[ -e "$RELEASES/current.next" || -L "$RELEASES/current.next" ]]; then
  if [[ ! -L "$RELEASES/current.next" && ! -f "$RELEASES/current.next" ]]; then
    echo "unexpected activation pointer" >&2
    exit 1
  fi
  rm -f -- "$RELEASES/current.next"
fi
ln -s "$VERSION" "$RELEASES/current.next"
CURRENT_ACTIVATED=true
mv -T "$RELEASES/current.next" "$RELEASES/current"
test "$(readlink "$RELEASES/current")" = "$VERSION"
test -f "$RELEASES/current/latest.json"
test -f "$RELEASES/current/web.json"
served_identity "stable latest.json" "$PUBLIC_URL/updates/stable/latest.json"
served_identity "stable web.json" "$PUBLIC_URL/updates/stable/web.json"
rm -f "$SYNAPSE_DEPLOY_ROOT/docker-compose.yml.rollback"
archive_snapshot_cleanup
ARCHIVE_SNAPSHOT=""
trap - EXIT
