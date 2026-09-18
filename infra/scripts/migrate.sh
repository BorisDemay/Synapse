#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env.example}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

echo "applying embedded server migrations by restarting the API"
"${COMPOSE[@]}" up -d postgres --wait
"${COMPOSE[@]}" up -d --force-recreate server --wait
bash infra/docker/healthcheck.sh "${SYNAPSE_SELFHOST_URL:-http://127.0.0.1:8080}"
echo "migrations applied (server startup path)"
