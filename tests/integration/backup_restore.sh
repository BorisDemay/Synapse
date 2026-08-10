#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml --env-file .env.example)
export COMPOSE_PROJECT_NAME=synapse-backup-test
BASE_URL="${SYNAPSE_SELFHOST_URL:-http://127.0.0.1:8080}"
BACKUP_DIR="$(mktemp -d /tmp/synapse-backup-XXXX)"

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

uuid7() {
  python3 - <<'PY'
import os, time
ts = int(time.time() * 1000) & ((1 << 48) - 1)
rand = bytearray(os.urandom(10))
b = bytearray(16)
b[0:6] = ts.to_bytes(6, "big")
b[6] = 0x70 | (rand[0] & 0x0F)
b[7] = rand[1]
b[8] = 0x80 | (rand[2] & 0x3F)
b[9:] = rand[3:10]
print("%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x" % tuple(b))
PY
}

echo "==> start stack"
"${COMPOSE[@]}" up --build -d --wait
bash infra/docker/healthcheck.sh "$BASE_URL"

EMAIL="backup-$(date +%s)@example.test"
PASSWORD="a secure password"
curl -fsS --max-time 20 -X POST "$BASE_URL/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" -o /dev/null

LOGIN_HEADERS="$(mktemp)"
curl -fsS --max-time 20 -D "$LOGIN_HEADERS" -o /dev/null -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
COOKIE="$(awk -F': ' 'tolower($1)=="set-cookie"{print $2; exit}' "$LOGIN_HEADERS" | cut -d';' -f1)"
test -n "$COOKIE"

VAULT_JSON="$(curl -fsS --max-time 20 -X POST "$BASE_URL/vaults" \
  -H "Cookie: $COOKIE" \
  -H "Origin: $BASE_URL" \
  -H 'content-type: application/json' \
  -d '{}')"
VAULT_ID="$(printf '%s' "$VAULT_JSON" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
test -n "$VAULT_ID"

NOTE_ID="$(uuid7)"
OP_ID="$(uuid7)"
CIPHERTEXT="$(python3 - <<'PY'
print(','.join(str(b) for b in bytes(range(16))))
PY
)"
HASH="$(python3 - <<'PY'
import hashlib
print(hashlib.sha256(bytes(range(16))).hexdigest())
PY
)"
NONCE="$(python3 - <<'PY'
print(','.join(['1'] * 24))
PY
)"

curl -fsS --max-time 20 -X POST "$BASE_URL/v1/vaults/$VAULT_ID/operations" \
  -H "Cookie: $COOKIE" \
  -H "Origin: $BASE_URL" \
  -H 'content-type: application/json' \
  -d "{\"protocol_version\":1,\"operation_id\":\"$OP_ID\",\"vault_id\":\"$VAULT_ID\",\"note_id\":\"$NOTE_ID\",\"base_revision\":0,\"aad_version\":1,\"nonce\":[$NONCE],\"ciphertext\":[$CIPHERTEXT],\"ciphertext_hash\":\"$HASH\"}" \
  -o /dev/null

echo "==> backup"
chmod +x infra/scripts/backup.sh infra/scripts/restore.sh infra/scripts/migrate.sh
bash infra/scripts/backup.sh "$BACKUP_DIR" >/tmp/backup-path.txt
test -f "$BACKUP_DIR/latest/postgres.dump" || test -f "$(readlink -f "$BACKUP_DIR/latest")/postgres.dump"

echo "==> destroy volumes"
"${COMPOSE[@]}" down -v
"${COMPOSE[@]}" up -d --wait
bash infra/docker/healthcheck.sh "$BASE_URL"

# Account should be gone before restore.
if curl -fsS --max-time 20 -o /dev/null -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"; then
  echo "expected login to fail on empty database" >&2
  exit 1
fi

echo "==> restore"
bash infra/scripts/restore.sh --yes "$BACKUP_DIR/latest"
"${COMPOSE[@]}" up -d --wait
bash infra/docker/healthcheck.sh "$BASE_URL"

LOGIN_HEADERS2="$(mktemp)"
curl -fsS --max-time 20 -D "$LOGIN_HEADERS2" -o /dev/null -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
COOKIE2="$(awk -F': ' 'tolower($1)=="set-cookie"{print $2; exit}' "$LOGIN_HEADERS2" | cut -d';' -f1)"
OPS="$(curl -fsS --max-time 20 "$BASE_URL/v1/vaults/$VAULT_ID/operations?limit=10" -H "Cookie: $COOKIE2")"
echo "$OPS" | grep -q "$HASH"

# Refuse restore without confirmation.
if bash infra/scripts/restore.sh "$BACKUP_DIR/latest"; then
  echo "expected restore without --yes to fail" >&2
  exit 1
fi

echo "backup/restore verified"
