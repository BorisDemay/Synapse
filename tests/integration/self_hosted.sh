#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export COMPOSE_PROJECT_NAME="synapse-selfhost-$$-$RANDOM"
export SYNAPSE_HTTP_PORT="${SYNAPSE_HTTP_PORT:-18090}"
export SYNAPSE_ALLOWED_ORIGIN="http://127.0.0.1:$SYNAPSE_HTTP_PORT"
export SYNAPSE_ENV=development
export SYNAPSE_ALLOW_PUBLIC_SIGNUP=true
export SYNAPSE_COOKIE_SECURE=false
export SYNAPSE_DEV_FIXTURE=true
BASE_URL="$SYNAPSE_ALLOWED_ORIGIN"
COMPOSE=(docker compose -f docker-compose.yml --env-file .env.development.example)
WORKDIR="$(mktemp -d /tmp/synapse-selfhost-XXXXXX)"
started=false
cleanup() {
  if $started; then "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || printf '%s\n' 'Unable to clean isolated self-host test stack' >&2; fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT
python3 - "$SYNAPSE_HTTP_PORT" <<'PY'
import socket, sys
with socket.socket() as probe:
    probe.bind(('127.0.0.1', int(sys.argv[1])))
PY
started=true
"${COMPOSE[@]}" up --build -d --wait
bash infra/docker/healthcheck.sh "$BASE_URL"
EMAIL="selfhost-$$@example.test"
PASSWORD="a secure password"
curl -fsS --max-time 20 -X POST "$BASE_URL/auth/signup" -H "Origin: $BASE_URL" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" -o /dev/null
# Delivery/activation UI is covered by Playwright; only this isolated fixture is activated here.
"${COMPOSE[@]}" exec -T postgres psql -U synapse -d synapse -v ON_ERROR_STOP=1 -v email="$EMAIL" <<'SQL'
UPDATE users SET activated_at = CURRENT_TIMESTAMP WHERE email = :'email';
SQL
curl -fsS --max-time 20 -D "$WORKDIR/headers" -o /dev/null -X POST "$BASE_URL/auth/login" -H "Origin: $BASE_URL" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
COOKIE="$(awk -F': ' 'tolower($1)=="set-cookie"{print $2; exit}' "$WORKDIR/headers" | cut -d';' -f1)"
test -n "$COOKIE"
SESSION="$(curl -fsS --max-time 20 "$BASE_URL/v1/session" -H "Cookie: $COOKIE")"
python3 -c 'import json,sys; assert json.loads(sys.argv[1])["user_id"]' "$SESSION"
"${COMPOSE[@]}" stop
"${COMPOSE[@]}" up -d --wait
bash infra/docker/healthcheck.sh "$BASE_URL"
SESSION_AFTER="$(curl -fsS --max-time 20 "$BASE_URL/v1/session" -H "Cookie: $COOKIE")"
test "$SESSION" = "$SESSION_AFTER"
curl -fsS --max-time 20 -o /dev/null -X POST "$BASE_URL/auth/login" -H "Origin: $BASE_URL" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
echo 'Isolated self-hosted deployment and persistent account/session verified'
