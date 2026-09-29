#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
DEST="${1:?usage: backup.sh <backup-directory>}"
COMPOSE=(docker compose -f "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env.example}")
mkdir -p -- "$DEST"
DEST="$(cd "$DEST" && pwd)"
WORK="$(mktemp -d "$DEST/.incomplete-XXXXXXXX")"
RESUME=0
cleanup() {
  local code=$?
  if [[ "$RESUME" == 1 ]]; then
    "${COMPOSE[@]}" start server >&2 || code=1
    "${COMPOSE[@]}" up -d --no-deps --wait server >&2 || code=1
  fi
  if [[ "$code" != 0 && -d "$WORK" ]]; then
    echo "backup failed; incomplete directory: $WORK" >&2
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SERVER="$("${COMPOSE[@]}" ps -a -q server)"
[[ -n "$SERVER" ]] || { echo 'server container is required' >&2; exit 1; }
if [[ "$(docker inspect -f '{{.State.Running}}' "$SERVER")" == true ]]; then
  RESUME=1
  "${COMPOSE[@]}" stop server >&2
fi
mkdir "$WORK/blobs"
"${COMPOSE[@]}" exec -T postgres sh -eu -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$WORK/postgres.dump"
docker cp "$SERVER:/var/lib/synapse/blobs/." "$WORK/blobs/"
python3 - "$WORK" <<'PY'
import datetime, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
(root / 'backup.json').write_text(json.dumps({'version': 1, 'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}) + '\n')
PY
python3 infra/scripts/backup_manifest.py create "$WORK"
python3 infra/scripts/backup_manifest.py verify "$WORK"
if [[ "$RESUME" == 1 ]]; then
  "${COMPOSE[@]}" start server >&2
  "${COMPOSE[@]}" up -d --no-deps --wait server >&2
  RESUME=0
fi
FINAL="$DEST/synapse-backup-$(date -u +%Y%m%dT%H%M%SZ)-${WORK##*-}"
mv -- "$WORK" "$FINAL"
ln -s "${FINAL##*/}" "$DEST/.latest-${FINAL##*-}"
mv -Tf -- "$DEST/.latest-${FINAL##*-}" "$DEST/latest"
# The backup may run before a release migration has added this table. Create
# only this operational marker, idempotently, after the backup is published.
# A database error fails the command but never claims a backup succeeded.
if ! "${COMPOSE[@]}" exec -T postgres sh -eu -c '
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c "CREATE TABLE IF NOT EXISTS backup_status (id SMALLINT PRIMARY KEY CHECK (id = 1), verified_at TIMESTAMPTZ NOT NULL); INSERT INTO backup_status (id, verified_at) VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET verified_at = EXCLUDED.verified_at" >/dev/null
'; then
  echo "backup published but its verification timestamp could not be recorded" >&2
  exit 1
fi
echo "$FINAL"
