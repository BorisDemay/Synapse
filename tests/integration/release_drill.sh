#!/usr/bin/env bash
# Isolated release drill for infra/scripts/deploy-release.sh.
#
# It builds tiny stand-in server/web images that carry the immutable image
# labels and serve the release identity over TLS, then runs the real deployer
# against a private deployment root. It observes:
#   - the pre-deployment backup fires only when migration checksums change;
#   - a successful activation exposes matching manifests through the stable
#     pointer;
#   - a divergent served manifest identity rolls the images and the pointer
#     back to the previously active release.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PREVIOUS="0.1.911"
TARGET="0.1.912"
FAILING="0.1.913"
SHA_PREVIOUS="$(printf 'a%.0s' {1..40})"
SHA_TARGET="$(printf 'b%.0s' {1..40})"
SHA_FAILING="$(printf 'c%.0s' {1..40})"
SHA_DIVERGENT="$(printf 'd%.0s' {1..40})"

WORK="$(mktemp -d /tmp/synapse-release-drill-XXXXXX)"
chmod 0755 "$WORK"
PROJECT="synapse-release-drill-$$-$RANDOM"
# No explicit compose `name:`: the project name is derived from this directory,
# which is exactly what must stay identical for the running and candidate
# compose files.
DEPLOY_ROOT="$WORK/$PROJECT"
CERTS="$WORK/certs"
INCOMING="$DEPLOY_ROOT/incoming"
BUILD="$WORK/image"
BACKUP_LOG="$WORK/backups.log"
PORT="$(python3 - <<'PY'
import socket

with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    print(probe.getsockname()[1])
PY
)"

COMPOSE=(docker compose -f "$DEPLOY_ROOT/docker-compose.yml" --env-file "$DEPLOY_ROOT/.env")
cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm -f \
    "synapse-drill:$PREVIOUS" "synapse-drill:$TARGET" "synapse-drill:$FAILING" \
    "synapse-server:$PREVIOUS" "synapse-web:$PREVIOUS" \
    "synapse-server:$TARGET" "synapse-web:$TARGET" \
    "synapse-server:$FAILING" "synapse-web:$FAILING" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

write_manifests() {
  local directory="$1" version="$2" sha="$3"
  python3 - "$directory" "$version" "$sha" "$PORT" <<'PY'
import json
import pathlib
import sys

directory, version, sha, port = sys.argv[1:5]
base = f"https://127.0.0.1:{port}/updates/stable/{version}"
identity = {
    "commit_sha": sha,
    "notes": "isolated release drill",
    "pub_date": "2026-09-12T12:00:00Z",
    "version": version,
}
latest = {
    **identity,
    "platforms": {
        "linux-x86_64": {
            "signature": "drill-linux",
            "url": f"{base}/synapse-linux-x86_64.AppImage",
        },
        "windows-x86_64": {
            "signature": "drill-windows",
            "url": f"{base}/synapse-windows-x86_64.exe",
        },
    },
}
root = pathlib.Path(directory)
root.mkdir(parents=True, exist_ok=True)
(root / "latest.json").write_text(f"{json.dumps(latest)}\n")
(root / "web.json").write_text(f"{json.dumps(identity)}\n")
PY
}

build_images() {
  local version="$1" sha="$2"
  docker build --quiet \
    --build-arg "SYNAPSE_VERSION=$version" \
    --build-arg "SYNAPSE_COMMIT_SHA=$sha" \
    -t "synapse-drill:$version" "$BUILD" >/dev/null
  docker tag "synapse-drill:$version" "synapse-server:$version"
  docker tag "synapse-drill:$version" "synapse-web:$version"
}

make_archive() {
  local version="$1" manifest_sha="$2" migrations="$3"
  local payload="$WORK/payload-$version"
  rm -rf "$payload"
  mkdir -p "$payload/release/stable/$version"
  printf '%s\n' "$migrations" > "$payload/migrations.sha256"
  cp "$ROOT/infra/scripts/release/validate-release.mjs" "$payload/validate-release.mjs"
  docker save -o "$payload/synapse-server-$version.tar" "synapse-server:$version"
  docker save -o "$payload/synapse-web-$version.tar" "synapse-web:$version"
  write_manifests "$payload/release/stable" "$version" "$manifest_sha"
  printf 'appimage-%s\n' "$version" > "$payload/release/stable/$version/synapse-linux-x86_64.AppImage"
  printf 'windows-%s\n' "$version" > "$payload/release/stable/$version/synapse-windows-x86_64.exe"
  (cd "$payload" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
  tar -C "$payload" -czf "$INCOMING/synapse-$version.tar.gz" .
}

seed_release() {
  local version="$1" sha="$2"
  local directory="$DEPLOY_ROOT/releases/stable/$version"
  mkdir -p "$directory"
  printf 'appimage-%s\n' "$version" > "$directory/synapse-linux-x86_64.AppImage"
  printf 'windows-%s\n' "$version" > "$directory/synapse-windows-x86_64.exe"
  write_manifests "$directory" "$version" "$sha"
  ln -sfn "$version" "$DEPLOY_ROOT/releases/stable/current"
}

served_version() {
  curl -fsS --cacert "$CERTS/server.crt" "https://127.0.0.1:$PORT$1" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])'
}

expect_served_version() {
  local path="$1" expected="$2"
  for _ in {1..30}; do
    if [[ "$(served_version "$path" 2>/dev/null || true)" == "$expected" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "$path did not report $expected" >&2
  return 1
}

deploy() {
  SYNAPSE_DEPLOY_ROOT="$DEPLOY_ROOT" \
    SYNAPSE_DRILL_BACKUP_LOG="$BACKUP_LOG" \
    CURL_CA_BUNDLE="$CERTS/server.crt" \
    bash "$ROOT/infra/scripts/deploy-release.sh" "$@"
}

echo "==> prepare deployment root"
mkdir -p "$DEPLOY_ROOT/infra/scripts" "$DEPLOY_ROOT/releases/stable" "$CERTS" "$INCOMING" "$BUILD"
cp "$ROOT/infra/scripts/check-deployment-layout.py" "$DEPLOY_ROOT/infra/scripts/"
cat > "$DEPLOY_ROOT/infra/scripts/backup.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'ENV_FILE=%s %s\n' "${ENV_FILE:-}" "$*" >> "${SYNAPSE_DRILL_BACKUP_LOG:?}"
SH
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout "$CERTS/server.key" -out "$CERTS/server.crt" \
  -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" >/dev/null 2>&1
chmod 0644 "$CERTS/server.key" "$CERTS/server.crt"

cat > "$BUILD/Dockerfile" <<'DOCKER'
FROM nginx:alpine
ARG SYNAPSE_VERSION=0.1.0
ARG SYNAPSE_COMMIT_SHA=development
LABEL org.opencontainers.image.version=$SYNAPSE_VERSION
LABEL org.opencontainers.image.revision=$SYNAPSE_COMMIT_SHA
RUN mkdir -p /srv/identity/health
RUN printf '{"version":"%s","commit_sha":"%s"}' "$SYNAPSE_VERSION" "$SYNAPSE_COMMIT_SHA" > /srv/identity/health/version
RUN printf '{"version":"%s","commit_sha":"%s"}' "$SYNAPSE_VERSION" "$SYNAPSE_COMMIT_SHA" > /srv/identity/build.json
COPY nginx.conf /etc/nginx/nginx.conf
DOCKER
cat > "$BUILD/nginx.conf" <<'NGINX'
events {}
http {
  server {
    listen 3000;
    root /srv/identity;
    location = /health/version { try_files /health/version =404; }
  }
  server {
    listen 443 ssl;
    ssl_certificate /certs/server.crt;
    ssl_certificate_key /certs/server.key;
    root /srv/identity;
    location = /build.json { try_files /build.json =404; }
    location = /health/version { try_files /health/version =404; }
    location = /updates/stable/latest.json { alias /usr/share/nginx/updates/stable/current/latest.json; }
    location = /updates/stable/web.json { alias /usr/share/nginx/updates/stable/current/web.json; }
    location /updates/stable/ { root /usr/share/nginx; }
  }
}
NGINX

cat > "$DEPLOY_ROOT/docker-compose.yml" <<COMPOSE
services:
  postgres:
    image: alpine:3.20
    command: ["sleep", "infinity"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
  server:
    image: synapse-server:\${SYNAPSE_VERSION:-$PREVIOUS}
    command: ["sleep", "infinity"]
    volumes:
      - \${SYNAPSE_DRILL_CERTS}:/certs:ro
  web:
    image: synapse-web:\${SYNAPSE_VERSION:-$PREVIOUS}
    ports:
      - "127.0.0.1:\${SYNAPSE_DRILL_PORT}:443"
    volumes:
      - \${SYNAPSE_RELEASES_PATH}:/usr/share/nginx/updates:ro
      - \${SYNAPSE_DRILL_CERTS}:/certs:ro
volumes:
  postgres_data:
COMPOSE
cat > "$DEPLOY_ROOT/.env" <<ENV
SYNAPSE_PUBLIC_URL=https://127.0.0.1:$PORT
SYNAPSE_RELEASES_PATH=$DEPLOY_ROOT/releases
SYNAPSE_DRILL_CERTS=$CERTS
SYNAPSE_DRILL_PORT=$PORT
ENV

echo "==> seed previous release $PREVIOUS"
build_images "$PREVIOUS" "$SHA_PREVIOUS"
build_images "$TARGET" "$SHA_TARGET"
build_images "$FAILING" "$SHA_FAILING"
seed_release "$PREVIOUS" "$SHA_PREVIOUS"
printf 'mig-%s\n' "$PREVIOUS" > "$DEPLOY_ROOT/.migration-checksums"
printf '%s\n' "$PREVIOUS" > "$DEPLOY_ROOT/.active-version"
: > "$BACKUP_LOG"

SYNAPSE_VERSION="$PREVIOUS" "${COMPOSE[@]}" up -d --no-build >/dev/null
expect_served_version /build.json "$PREVIOUS"

echo "==> deploy $TARGET with changed migrations"
make_archive "$TARGET" "$SHA_TARGET" "mig-$TARGET"
deploy "$TARGET" "$SHA_TARGET"
test "$(tr -d '\r\n' < "$DEPLOY_ROOT/.active-version")" = "$TARGET"
test "$(readlink "$DEPLOY_ROOT/releases/stable/current")" = "$TARGET"
test "$(wc -l < "$BACKUP_LOG")" -eq 1
grep -q "ENV_FILE=$DEPLOY_ROOT/.env " "$BACKUP_LOG"
expect_served_version /build.json "$TARGET"
expect_served_version /updates/stable/web.json "$TARGET"
expect_served_version /updates/stable/latest.json "$TARGET"

echo "==> deploy $FAILING with a divergent served manifest"
make_archive "$FAILING" "$SHA_DIVERGENT" "mig-$TARGET"
if deploy "$FAILING" "$SHA_FAILING" 2>"$WORK/failing.stderr"; then
  echo "expected the divergent manifest deployment to fail" >&2
  exit 1
fi
grep -q "does not expose the deployed identity" "$WORK/failing.stderr"
test "$(tr -d '\r\n' < "$DEPLOY_ROOT/.active-version")" = "$TARGET"
test "$(readlink "$DEPLOY_ROOT/releases/stable/current")" = "$TARGET"
test "$(wc -l < "$BACKUP_LOG")" -eq 1
expect_served_version /build.json "$TARGET"
expect_served_version /updates/stable/web.json "$TARGET"

echo 'release drill verified: migration backup, manifest-last activation and image rollback'
