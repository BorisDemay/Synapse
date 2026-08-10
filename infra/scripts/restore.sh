#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

YES=0
SRC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1; shift ;;
    -*)
      echo "unknown option: $1" >&2
      exit 2
      ;;
    *)
      SRC="$1"
      shift
      ;;
  esac
done

if [[ -z "$SRC" ]]; then
  echo "usage: $0 --yes <backup-directory>" >&2
  exit 2
fi
if [[ "$YES" -ne 1 ]]; then
  echo "refusing destructive restore without --yes" >&2
  exit 3
fi

if [[ -L "$SRC/latest" ]]; then
  SRC="$SRC/$(readlink "$SRC/latest")"
fi
SRC="$(cd "$SRC" && pwd)"
test -f "$SRC/postgres.dump"
test -f "$SRC/backup.json"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env.example}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

AVAILABLE_KB="$(df -Pk "$ROOT" | awk 'NR==2{print $4}')"
BACKUP_KB="$(du -sk "$SRC" | awk '{print $1}')"
NEEDED_KB=$((BACKUP_KB * 2 + 102400))
if [[ "$AVAILABLE_KB" -lt "$NEEDED_KB" ]]; then
  echo "insufficient disk space: need ~${NEEDED_KB}KiB, have ${AVAILABLE_KB}KiB" >&2
  exit 4
fi

echo "restoring from $SRC"
"${COMPOSE[@]}" stop server caddy web >/dev/null
"${COMPOSE[@]}" up -d postgres
"${COMPOSE[@]}" exec -T postgres \
  pg_isready -U "${POSTGRES_USER:-synapse}" -d "${POSTGRES_DB:-synapse}" >/dev/null

# Drop and recreate database contents from custom dump.
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-synapse}" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB:-synapse}' AND pid <> pg_backend_pid();" \
  >/dev/null
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-synapse}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB:-synapse};" >/dev/null
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-synapse}" -d postgres \
  -c "CREATE DATABASE ${POSTGRES_DB:-synapse} OWNER ${POSTGRES_USER:-synapse};" >/dev/null
"${COMPOSE[@]}" exec -T -i postgres \
  pg_restore -U "${POSTGRES_USER:-synapse}" -d "${POSTGRES_DB:-synapse}" --clean --if-exists \
  <"$SRC/postgres.dump" || true

"${COMPOSE[@]}" up -d server
SERVER="$("${COMPOSE[@]}" ps -q server)"
docker exec "$SERVER" sh -c 'rm -rf /var/lib/synapse/blobs/*'
docker cp "$SRC/blobs/." "$SERVER:/var/lib/synapse/blobs/"

"${COMPOSE[@]}" up -d
echo "restore completed"
