# Synapse local quality gates (AGPLv3).
# Requires: Rust toolchain, pnpm, just, cargo-nextest, cargo-deny.
# Integration/e2e paths expect PostgreSQL on 127.0.0.1:55432 (see infra/docker/compose.test.yml).

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export PATH := env_var_or_default("HOME", "/root") + "/.cargo/bin:" + env_var("PATH")

default:
    @just --list

# Format check, clippy, tests, frontend gates, Playwright smoke, cargo-deny, pnpm audit.
verify: fmt-check clippy test-rust test-js typecheck lint audit-rust audit-js e2e-smoke
    @echo "just verify: all gates passed"

fmt-check:
    cargo fmt --all -- --check

fmt:
    cargo fmt --all
    pnpm format

clippy:
    cargo clippy --workspace --all-targets -- -D warnings

test-rust:
    # Clear server env overrides so unit/integration tests use their defaults
    # (invite-gated signup, Secure cookies, CSRF origin https://synapse.local).
    env -u SYNAPSE_ALLOW_PUBLIC_SIGNUP -u SYNAPSE_COOKIE_SECURE -u SYNAPSE_ALLOWED_ORIGIN \
      cargo nextest run --workspace

test-js:
    pnpm test

typecheck:
    pnpm typecheck

lint:
    pnpm lint

audit-rust:
    cargo deny check

audit-js:
    pnpm audit --prod

# Targeted Playwright smoke (API + Vite must be reachable; see docs/operations/ci.md).
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
