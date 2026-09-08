# Synapse local quality gates (AGPLv3).
# Requires: Rust toolchain, pnpm, just, cargo-nextest, cargo-deny.
# Tests use synapse_test on 127.0.0.1:55432. Interactive `just serve` / `just dev`
# / `just desktop` use synapse_dev on the same instance so cargo tests
# (DROP SCHEMA / TRUNCATE) cannot delete local accounts.

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export PATH := env_var_or_default("HOME", "/root") + "/.cargo/bin:" + env_var("PATH")

default:
    @just --list

# Start the shared test/dev PostgreSQL (synapse_test for cargo tests, synapse_dev for the API).
db:
    docker compose -f infra/docker/compose.test.yml up -d --wait
    docker compose -f infra/docker/compose.test.yml exec -T postgres \
      psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'synapse_dev'" \
      | grep -qx 1 \
      || docker compose -f infra/docker/compose.test.yml exec -T postgres \
        psql -U postgres -c "CREATE DATABASE synapse_dev"

# Local API against the persistent synapse_dev database (not the wipeable test DB).
# JSON API only — pair with `just web`, or use `just dev` for both.
serve: db
    @echo "API  http://${SYNAPSE_BIND_ADDR:-127.0.0.1:3000}"
    @echo "UI   http://127.0.0.1:5173"
    mkdir -p synapse-blobs synapse-mail
    SYNAPSE_BIND_ADDR="${SYNAPSE_BIND_ADDR:-127.0.0.1:3000}" \
    SYNAPSE_DATABASE_URL="${SYNAPSE_DATABASE_URL:-postgres://postgres@127.0.0.1:55432/synapse_dev}" \
    SYNAPSE_STORAGE_PATH="${SYNAPSE_STORAGE_PATH:-$PWD/synapse-blobs}" \
    SYNAPSE_MAIL_DIRECTORY="${SYNAPSE_MAIL_DIRECTORY:-$PWD/synapse-mail}" \
    SYNAPSE_ALLOWED_ORIGIN="${SYNAPSE_ALLOWED_ORIGIN:-http://127.0.0.1:5173}" \
    SYNAPSE_ALLOW_PUBLIC_SIGNUP="${SYNAPSE_ALLOW_PUBLIC_SIGNUP:-true}" \
    SYNAPSE_COOKIE_SECURE="${SYNAPSE_COOKIE_SECURE:-false}" \
    SYNAPSE_ENV="${SYNAPSE_ENV:-development}" \
      cargo run -p synapse-server

# Vite web UI; proxies API calls to just serve on :3000.
web:
    pnpm --filter @synapse/web dev --host localhost --port 5173

# API + Vite in one terminal. Ctrl+C stops both.
[parallel]
dev: serve web

# Native Tauri client + local API. Ctrl+C stops both.
[parallel]
desktop: desktop-serve desktop-tauri

# Wait for migrations and the development fixture before opening the native UI.
# This remains a parallel dependency of `desktop`, so PostgreSQL/API startup and
# the readiness wait proceed alongside one another without exposing a half-ready
# login window.
[private]
desktop-tauri:
    for attempt in {1..60}; do \
      if curl --fail --silent --show-error --max-time 1 \
        "http://${SYNAPSE_BIND_ADDR:-127.0.0.1:3000}/health/ready" >/dev/null; then \
        exec just tauri; \
      fi; \
      sleep 0.25; \
    done; \
    echo "Synapse API did not become ready at http://${SYNAPSE_BIND_ADDR:-127.0.0.1:3000}" >&2; \
    exit 1

# API for the desktop client. CSRF origin matches the instance URL (ADR 0009).
[private]
desktop-serve: db
    @echo "API      http://${SYNAPSE_BIND_ADDR:-127.0.0.1:3000}"
    @echo "Desktop  native window (Vite http://127.0.0.1:1420)"
    mkdir -p synapse-blobs synapse-mail
    SYNAPSE_BIND_ADDR="${SYNAPSE_BIND_ADDR:-127.0.0.1:3000}" \
    SYNAPSE_DATABASE_URL="${SYNAPSE_DATABASE_URL:-postgres://postgres@127.0.0.1:55432/synapse_dev}" \
    SYNAPSE_STORAGE_PATH="${SYNAPSE_STORAGE_PATH:-$PWD/synapse-blobs}" \
    SYNAPSE_MAIL_DIRECTORY="${SYNAPSE_MAIL_DIRECTORY:-$PWD/synapse-mail}" \
    SYNAPSE_ALLOWED_ORIGIN="${SYNAPSE_ALLOWED_ORIGIN:-http://127.0.0.1:3000}" \
    SYNAPSE_ALLOW_PUBLIC_SIGNUP="${SYNAPSE_ALLOW_PUBLIC_SIGNUP:-true}" \
    SYNAPSE_COOKIE_SECURE="${SYNAPSE_COOKIE_SECURE:-false}" \
    SYNAPSE_ENV="${SYNAPSE_ENV:-development}" \
      cargo run -p synapse-server

# Tauri window only (local vault). Pair with `just desktop` for Postgres + API.
# WSLg forwards the XKB layout to WebKit; default to French while allowing an override.
tauri:
    if [ -n "${WSL_INTEROP:-}" ] && command -v setxkbmap >/dev/null 2>&1; then \
      setxkbmap -layout "${SYNAPSE_KEYBOARD_LAYOUT:-fr}"; \
    fi; \
    GDK_BACKEND="${GDK_BACKEND:-x11}" \
    WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}" \
      pnpm --filter @synapse/desktop tauri dev

# Format check, clippy, tests, frontend gates, Playwright smoke, cargo-deny, pnpm audit.
verify: fmt-check clippy test-rust test-native-rust test-js test-harness test-release test-operations typecheck lint audit-rust audit-js e2e-recovery test-recovery
    @echo "just verify: all gates passed"

fmt-check:
    cargo fmt --all -- --check
    cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check

fmt:
    cargo fmt --all
    pnpm format

clippy:
    cargo clippy --workspace --all-targets -- -D warnings
    cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings

test-rust:
    # Clear server env overrides so unit/integration tests use their defaults
    # (invite-gated signup, Secure cookies, CSRF origin https://synapse.local).
    env -u SYNAPSE_ALLOW_PUBLIC_SIGNUP -u SYNAPSE_COOKIE_SECURE -u SYNAPSE_ALLOWED_ORIGIN \
      cargo nextest run --workspace

test-native-rust:
    cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

test-harness:
    node --test tests/harness/*.test.mjs

test-release:
    node --test tests/release/*.test.mjs

test-operations:
    python3 -m unittest tests/operations/backup_test.py

test-recovery:
    bash tests/integration/self_hosted.sh
    bash tests/integration/backup_restore.sh

e2e-recovery:
    pnpm exec playwright test tests/e2e/web-register-save.spec.ts tests/e2e/web-offline.spec.ts tests/e2e/reliability.spec.ts tests/e2e/conflict-resolution.spec.ts tests/e2e/full-sync.spec.ts tests/e2e/offline-update.spec.ts

test-js:
    pnpm test

typecheck:
    pnpm typecheck

lint:
    pnpm lint

audit-rust:
    cargo deny check
    cargo deny --manifest-path apps/desktop/src-tauri/Cargo.toml check

audit-js:
    pnpm audit --prod

# Targeted Playwright smoke. Its Playwright global setup starts PostgreSQL, the
# API and Vite with bounded readiness checks, then removes its temporary data.
e2e-smoke:
    SYNAPSE_ALLOW_PUBLIC_SIGNUP="${SYNAPSE_ALLOW_PUBLIC_SIGNUP:-true}" \
      SYNAPSE_COOKIE_SECURE="${SYNAPSE_COOKIE_SECURE:-false}" \
      pnpm exec playwright test tests/e2e/web-register-save.spec.ts

# CycloneDX SBOMs as release artifacts only (not committed).
sbom:
    mkdir -p target/sbom
    command -v cargo-cyclonedx >/dev/null || cargo install cargo-cyclonedx --locked
    cargo cyclonedx --manifest-path apps/server/Cargo.toml --format json --all --override-filename rust
    mv -f apps/server/rust.json target/sbom/rust.cdx.json
    pnpm dlx @cyclonedx/cdxgen@11.4.3 -o target/sbom/node.cdx.json --json-pretty
    @echo "SBOMs written under target/sbom/"
