#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
YES=0
SRC=''
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    -*) echo 'unknown option' >&2; exit 2 ;;
    *) [[ -z "$SRC" ]] || exit 2; SRC="$arg" ;;
  esac
done
[[ "$YES" == 1 ]] || { echo 'refusing destructive restore without --yes' >&2; exit 3; }
[[ -n "$SRC" ]] || exit 2
if [[ -L "$SRC/latest" ]]; then SRC="$SRC/latest"; fi
SRC="$(cd "$SRC" && pwd -P)"
python3 infra/scripts/backup_manifest.py verify "$SRC"
COMPOSE=(docker compose -f "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env.example}")
AVAILABLE_KB="$(df -Pk "$ROOT" | awk 'NR==2{print $4}')"
BACKUP_KB="$(du -sk "$SRC" | awk '{print $1}')"
(( AVAILABLE_KB >= BACKUP_KB * 2 + 102400 )) || { echo 'insufficient disk space' >&2; exit 4; }
"${COMPOSE[@]}" up -d --wait postgres >&2
# Validate the archive before stopping services or changing the target database.
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$SRC/postgres.dump" >/dev/null
# Use the actual container configuration, not potentially different host defaults.
"${COMPOSE[@]}" exec -T postgres sh -eu -c '
case "$POSTGRES_DB:$POSTGRES_USER" in *[!a-zA-Z0-9_:]*) exit 2;; esac
[ -n "$POSTGRES_DB" ] && [ -n "$POSTGRES_USER" ]
[ "$POSTGRES_DB" != postgres ] && [ "$POSTGRES_DB" != template0 ] && [ "$POSTGRES_DB" != template1 ]
'
"${COMPOSE[@]}" stop server caddy web >&2
restore_failed() {
  local code=$?
  "${COMPOSE[@]}" stop server caddy web >&2 || true
  echo "restore failed; API stop requested; correct the problem and retry restore" >&2
  exit "$code"
}
trap restore_failed ERR
"${COMPOSE[@]}" exec -T postgres sh -eu -c '
dropdb --force --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"
createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"
'
"${COMPOSE[@]}" exec -T postgres sh -eu -c 'pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$SRC/postgres.dump"
# A one-off container mounts the same volume without starting the API. Root is
# restricted to this maintenance container so restored files retain API ownership.
"${COMPOSE[@]}" run --rm --no-deps -T --user 0 --entrypoint sh -v "$SRC/blobs:/restore:ro" server -eu -c '
find /var/lib/synapse/blobs -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a /restore/. /var/lib/synapse/blobs/
chown -R 10001:10001 /var/lib/synapse/blobs
'
"${COMPOSE[@]}" up -d --wait postgres server web caddy >&2
trap - ERR
echo 'restore completed'
