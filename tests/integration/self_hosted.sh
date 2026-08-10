#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml --env-file .env.example)
PROJECT=synapse-selfhost
export COMPOSE_PROJECT_NAME="$PROJECT"
BASE_URL="${SYNAPSE_SELFHOST_URL:-http://127.0.0.1:8080}"

cleanup() {
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> building and starting self-hosted stack"
"${COMPOSE[@]}" up --build -d --wait

echo "==> health checks"
bash infra/docker/healthcheck.sh "$BASE_URL"

EMAIL="selfhost-$(date +%s)@example.test"
PASSWORD="a secure password"

echo "==> public signup through the reverse proxy"
curl -fsS -X POST "$BASE_URL/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  -o /dev/null

LOGIN_HEADERS="$(mktemp)"
curl -fsS -D "$LOGIN_HEADERS" -o /dev/null -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
COOKIE="$(awk -F': ' 'tolower($1)=="set-cookie"{print $2; exit}' "$LOGIN_HEADERS" | cut -d';' -f1)"
test -n "$COOKIE"

SESSION="$(curl -fsS "$BASE_URL/v1/session" -H "Cookie: $COOKIE")"
echo "$SESSION" | grep -q 'user_id'

echo "==> restarting stack with persistent volumes"
"${COMPOSE[@]}" stop
"${COMPOSE[@]}" up -d --wait
bash infra/docker/healthcheck.sh "$BASE_URL"

SESSION_AFTER="$(curl -fsS "$BASE_URL/v1/session" -H "Cookie: $COOKIE" || true)"
# Session cookie may still be valid against persisted Postgres.
if [[ -n "$SESSION_AFTER" ]]; then
  echo "$SESSION_AFTER" | grep -q 'user_id'
fi

# Prove the account still authenticates after restart (data persisted).
curl -fsS -o /dev/null -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

echo "self-hosted compose deployment verified"
