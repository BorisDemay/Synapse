#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8080}"

curl --max-time 10 -fsS "$BASE_URL/health/live" | grep -q '"status":"ok"'
curl --max-time 10 -fsS "$BASE_URL/health/ready" | grep -q '"status":"ok"'
curl --max-time 10 -fsS "$BASE_URL/" >/dev/null

echo "health checks passed for $BASE_URL"
