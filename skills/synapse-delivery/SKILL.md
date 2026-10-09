---
name: synapse-delivery
description: Build and verify Vue, Tauri, Rust, and self-hosting.
version: 0.1.0
author: Project maintainer, Hermes Agent
license: AGPL-3.0-or-later
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [synapse, vue, tauri, rust, docker, testing]
    related_skills: []
---

# Synapse Delivery

Use this skill to implement or validate Vue/Tauri UX, Rust services, Docker Compose, CI, operations, tests, and release documentation. Preserve the planned split: Vue for presentation, Rust for sensitive and performance-critical boundaries.

## When to Use

- Creating or changing `apps/desktop/`, `apps/web/`, `apps/server/`, `packages/ui/`, `infra/`, `tests/`, CI, Docker, Caddy, backup or release documentation.
- Do not use it to bypass the security or sync skills; load `synapse-security` and/or `synapse-sync` first when their boundaries are involved.

## Implementation Rules

- Vue 3, TypeScript, Vite, Vue Router and Pinia are the frontend baseline. Use accessible semantic elements and keyboard navigation; no React dependency.
- Tauri has minimal capabilities only. Vue invokes typed commands; it does not receive unrestricted filesystem or shell access.
- Rust uses formatting, clippy with warnings denied, typed errors, async boundaries that do not block UI paths, and parameterized SQLx queries.
- Package versions are locked. New dependencies must be open source, compatible with AGPLv3, justified in the change, and audited.
- Docker images run non-root, expose health checks, use persistent volumes intentionally, and contain no secrets.
- The minimal self-hosted stack is server + PostgreSQL + filesystem blob volume + Caddy. Optional observability must not block startup.

## Procedure

1. Read the focused task and check existing project commands before changing files.
2. Write a single failing Rust, Vitest, Playwright, shell integration, or Docker test that describes the behavior. Run it and observe the intended failure.
3. Implement only enough to pass. Run the same target again, then the affected package suite.
4. Run formatting, types, linting, relevant E2E, and build checks. Do not replace missing results with an assertion of success.
5. For UI work, inspect keyboard, focus, empty, loading, error and offline states. For operations work, restart from an empty environment and verify persistent data.
6. Update the README only with verified commands and update operator docs for config, migration, backup, or rollback changes.

## Verification

Use the commands that exist in the evolving repository. The intended final baseline is:

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright test
docker compose config
```

For deployment changes also run the self-hosted installation and backup/restore scripts defined by the implementation plan.
