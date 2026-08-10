#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEST="${1:-}"
if [[ -z "$DEST" ]]; then
  echo "usage: $0 <backup-directory>" >&2
  exit 2
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env.example}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
PROJECT="${COMPOSE_PROJECT_NAME:-synapse}"

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$DEST/synapse-backup-$STAMP"
mkdir -p "$WORK/blobs"

echo "creating backup in $WORK" >&2
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-synapse}" -d "${POSTGRES_DB:-synapse}" --format=custom \
  >"$WORK/postgres.dump"

BLOB_CONTAINER="$("${COMPOSE[@]}" ps -q server)"
docker cp "$BLOB_CONTAINER:/var/lib/synapse/blobs/." "$WORK/blobs/" 2>/dev/null || true

POSTGRES_SHA="$(sha256sum "$WORK/postgres.dump" | awk '{print $1}')"
if find "$WORK/blobs" -type f | grep -q .; then
  BLOBS_SHA="$(find "$WORK/blobs" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
else
  BLOBS_SHA="$(printf '' | sha256sum | awk '{print $1}')"
fi

python3 - <<PY
import json, pathlib
path = pathlib.Path("$WORK/backup.json")
path.write_text(json.dumps({
  "version": 1,
  "created_at": "$STAMP",
  "project": "$PROJECT",
  "postgres_sha256": "$POSTGRES_SHA",
  "blobs_sha256": "$BLOBS_SHA",
}, indent=2) + "\n")
PY

(
  cd "$WORK"
  sha256sum postgres.dump backup.json
  if find blobs -type f | grep -q .; then
    find blobs -type f -print0 | sort -z | xargs -0 sha256sum
  fi
) >"$WORK/manifest.sha256"

ln -sfn "$(basename "$WORK")" "$DEST/latest"
echo "$WORK"
