#!/usr/bin/env bash
# Interactive local accounts must live in synapse_dev, not the wipeable
# synapse_test database used by cargo tests (DROP SCHEMA / TRUNCATE).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f infra/docker/compose.test.yml)
export COMPOSE_PROJECT_NAME=synapse-dev-persist
export SYNAPSE_TEST_PG_PORT="${SYNAPSE_TEST_PG_PORT:-55433}"

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> start disposable Postgres for persistence probe"
"${COMPOSE[@]}" up -d --wait

echo "==> dedicated dev database exists (separate from synapse_test)"
"${COMPOSE[@]}" exec -T postgres psql -U postgres -d synapse_dev -c "SELECT 1" >/dev/null

echo "==> write a sentinel account row in synapse_dev"
"${COMPOSE[@]}" exec -T postgres psql -U postgres -d synapse_dev -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE persist_probe (
    email TEXT PRIMARY KEY
);
INSERT INTO persist_probe (email) VALUES ('kept-across-restart@example.test');
SQL

echo "==> simulate a test wipe of synapse_test"
"${COMPOSE[@]}" exec -T postgres psql -U postgres -d synapse_test -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL

echo "==> recreate the container without deleting named volumes"
"${COMPOSE[@]}" down --remove-orphans
"${COMPOSE[@]}" up -d --wait

echo "==> synapse_dev still has the account after restart"
kept="$("${COMPOSE[@]}" exec -T postgres psql -U postgres -d synapse_dev -Atc "SELECT email FROM persist_probe")"
test "$kept" = "kept-across-restart@example.test"

echo "dev database persistence verified"
