# Synapse — local-first, end-to-end encrypted Markdown vault

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-stable-orange.svg)](https://www.rust-lang.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883.svg)](https://vuejs.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app/)

> A local-first, end-to-end encrypted and self-hostable knowledge workspace, inspired by Obsidian workflows without reusing its code or identity.

**Status: pre-release.** The MVP works: a Tauri desktop client, an encrypted
web interface, a self-hosted Rust server, operation-based synchronization and
signed updates. The server never sees a vault in plaintext.

- **Get started locally**: [Local development](#local-development)
- **Self-host**: [Docker Compose](#self-hosting-with-docker-compose) · [operator guide](docs/operations/install.md)
- **Security**: [threat model](docs/security/threat-model.md) · [report a vulnerability](SECURITY.md)
- **Contribute**: [CONTRIBUTING.md](CONTRIBUTING.md) · [code of conduct](CODE_OF_CONDUCT.md)
- **License**: [AGPL-3.0-or-later](#license)

## Vision

Synapse is a **from-scratch** project aiming to provide a fast, offline and
reliable Markdown note-taking experience, available through:

- a **desktop client** built with Tauri that carries the same encrypted vault as the web;
- a modern **web interface** to reach the same content from a browser;
- an optional, easy-to-self-host server that provides real-time synchronization and controlled sharing.

The shared client keeps its canonical state in an encrypted local cache. The
desktop client produces a readable Markdown replica in the chosen folder;
export remains possible without a server. Synchronization must never get in the
way of local work (ADR 0011, 0013 and 0016).

## Primary goals

1. **Performance** — instant vault opening, fluid search, low memory footprint and incremental synchronization.
2. **Security** — defensive design, data isolation, robust authentication, controlled logging and encryption in transit.
3. **Local-first** — the application stays usable offline; changes sync as soon as possible.
4. **Interoperability** — standard Markdown, attachments on disk, simple export and a documented API.
5. **Self-hosting** — reproducible deployment with minimal configuration, Docker/Compose and explicit backups.
6. **Reliability** — no silent loss: versioning, conflict detection, recovery after interruption and observability.

## Planned features

### Vault management

- Encrypted local cache, usable offline, for every authorized vault.
- Create, rename, move and delete notes and folders.
- Filesystem watching and handling of external changes.
- YAML front matter metadata, tags, `[[wikilinks]]`, backlinks and a relation graph.
- Markdown preview, rich or plain-text editing, keyboard shortcuts and light/dark theme.
- Local change history and version restore.
- Full-text search, filtering by tag/folder/property and incremental indexing.

### Synchronization and collaboration

- Bidirectional synchronization of Markdown notes and attachments.
- Real-time transport when the connection is available; incremental catch-up on reconnect.
- Synchronization by operations or blocks to avoid transferring an entire vault.
- Detection of concurrent changes and non-destructive conflict resolution.
- Per-vault/note status indicator: local, pending, synced, conflict, error.
- Future sharing by vault, folder or note with explicit roles (read, write, administration).

### Web interface

- Secure sign-in and session management.
- Navigation across authorized vaults, Markdown editing and preview.
- Search, backlinks, tags and history access according to permissions.
- Modern browser support, responsive interface and progressive offline cache.

## Architecture principles

```text
┌──────────────────────┐        HTTPS / WebSocket         ┌──────────────────────┐
│ Desktop client       │ ────────────────────────────────▶ │ Sync server          │
│ - local vault        │ ◀──────────────────────────────── │ - API/auth           │
│ - local index        │                                    │ - conflict engine     │
│ - operation queue    │                                    │ - metadata storage    │
└──────────────────────┘                                    └──────────┬───────────┘
         ▲                                                               │
         │                                                               ▼
         │ local                                               ┌──────────────────┐
┌────────┴─────────────┐                                      │ Blob storage     │
│ Web interface        │ ◀──────────────────────────────────▶ │ / files          │
│ - browser cache      │          HTTPS / WebSocket            └──────────────────┘
│ - Markdown editor    │
└──────────────────────┘
```

### Local-first model

Every client has:

- a local copy of the vault;
- a local index database for search and metadata;
- a persistent queue of operations that have not been sent yet;
- version markers so it can request only the missing changes.

The server coordinates changes and keeps the versions needed for replication. It
must not become a blocking point for local editing.

### Conflict strategy

The project must prefer explicit conflicts over silent overwrites:

- automatic merge only when the changes are clearly disjoint;
- keep both variants when a safe merge is not possible;
- comparison interface and user choice;
- audit log of resolutions and the ability to return to an earlier version.

For simultaneous collaborative editing inside the same note, a CRDT may be
adopted in a later phase. The final format must however remain cleanly
serializable to Markdown.

## Security

Security is a design requirement, not a finishing step.

### Baseline measures

- TLS is mandatory in production; HTTP redirects to HTTPS.
- Authentication with passwords hashed by a modern, resistant algorithm (Argon2id).
- Short sessions (8 h), `HttpOnly`, `Secure`, `SameSite` cookies, rotation and revocation; 30 days only when the user ticks "Remember this device" (account password, not the vault passphrase).
- Systematic server-side authorization on every vault, file and operation.
- Protection against common attacks: CSRF, XSS, injection, path traversal, SSRF, brute force and request replay.
- Strict API schema validation, size limits, quotas and rate limiting.
- Structured logging without note content, passwords, tokens or sensitive data.
- Locked dependencies, vulnerability scanning, regular updates and a generatable SBOM.
- Encrypted, tested and restorable backups.

### End-to-end encryption is mandatory for synchronization

In the MVP, all synchronized content is encrypted on the client before it is
sent, and the server only stores encrypted data. Local vaults remain usable
without a server. A decryption passphrase, distinct from the authentication
password, wraps the vault key locally and never crosses the API. This design
deliberately limits server-side key recovery, sharing and search; those limits
are documented.

## Performance and optimization

- Incremental indexing: only modified notes are re-parsed.
- Local search with a persistent index; pagination and cancellation of expensive queries.
- Lazy loading of the tree, previews and attachments.
- Delta synchronization, transfer compression and blob deduplication by content hash.
- Streaming of large files, with configurable caps.
- Avoid synchronous reads/writes on the interface critical path.
- Reproducible benchmarks for vault opening, indexing, search and synchronization.
- Profiling and metrics before any structural optimization.

## Architecture and MVP decisions

The responsibility boundaries of the monorepo are recorded in the ADRs:

- [ADR 0001 — Monorepo and trust boundaries](docs/adr/0001-monorepo-and-boundaries.md)
- [ADR 0002 — Operation and revision based synchronization](docs/adr/0002-sync-versioning.md)
- [ADR 0011 — The encrypted web client is canonical](docs/adr/0011-web-client-canonical.md)
- [ADR 0014 — Remembered account session](docs/adr/0014-remembered-account-session.md)
- [ADR 0015 — Continuous, signed updates](docs/adr/0015-continuous-signed-updates.md)
- [ADR 0013 — Desktop folder replica and server priority](docs/adr/0013-desktop-folder-replica-and-server-priority.md)
- [ADR 0016 — Standalone encrypted desktop vaults](docs/adr/0016-standalone-encrypted-desktop-vaults.md)
- [ADR 0007 — Instant-rendering Markdown editor](docs/adr/0007-vditor-instant-rendering-editor.md)
- [ADR 0008 — Optional client-side Codex assistant](docs/adr/0008-client-side-codex-assistant.md)
- [ADR 0010 — Encrypted vault item](docs/adr/0010-encrypted-vault-item.md)

The [MVP threat model](docs/security/threat-model.md) details the assets, trust
boundaries, threats and controls. The server is an opaque coordinator: it never
accesses vault content in plaintext.

## Target repository layout

```text
.
├── apps/
│   ├── desktop/          # Desktop client
│   ├── web/              # Web application
│   └── server/           # API, synchronization and workers
├── packages/
│   ├── core/             # Vault model, Markdown, links, conflicts
│   ├── protocol/         # API contracts and synchronization protocol
│   ├── ui/               # Shared components
│   └── config/           # Configuration, validation and observability
├── infra/
│   ├── docker/           # Images and Compose
│   ├── reverse-proxy/    # Caddy/Nginx examples
│   └── scripts/          # Backup, restore, maintenance
├── docs/                 # Architecture, security, operations
└── tests/                # Integration, load and end-to-end tests
```

## Verified MVP state

The [pre-release checklist](docs/testing/release-checklist.md) distinguishes
observed results, CI checks and validations that still have to run.

### Local development

```bash
just dev
```

Starts PostgreSQL (`synapse_dev`), the Rust API (`http://127.0.0.1:3000`) and the
Vite UI (`http://localhost:5173`) in a single terminal. `Ctrl+C` stops both. In
two terminals: `just serve` then `just web`.

```bash
just desktop
```

Starts PostgreSQL (`synapse_dev`), the Rust API (`http://127.0.0.1:3000`) and the
native Tauri window (Vite `http://127.0.0.1:1420`) in a single terminal.
`Ctrl+C` stops both. Editing uses the encrypted local cache and a desktop
Markdown replica, and does not block the interface during a network outage.

### Quality

```bash
just verify
```

Chains the Rust and frontend checks, the audits, the harness and operations
script tests, the Playwright recovery journeys, the Compose restart and restore
scenarios, then the release deployment drill. Docker and the native Rust
prerequisites are required. Details: `docs/operations/ci.md`.

The desktop client (local editor, optional sync) is also covered by:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @synapse/desktop test
pnpm --filter @synapse/desktop typecheck
# Linux/WSL without a graphical session:
dbus-run-session -- xvfb-run -a corepack pnpm --filter @synapse/desktop test:e2e:native
```

### Self-hosting with Docker Compose

```bash
cp .env.example .env
# Adjust SYNAPSE_ALLOWED_ORIGIN and the PostgreSQL secrets
bash tests/integration/self_hosted.sh
bash tests/integration/backup_restore.sh
bash tests/integration/release_drill.sh
```

`release_drill.sh` builds a disposable Compose project with labelled images and
local TLS, then runs the real `infra/scripts/deploy-release.sh`: backup on a
migration change, manifest-last activation and rollback of images and pointer.

Minimal stack: PostgreSQL + Rust API + web UI + Caddy + blob volume. Operator
guide: `docs/operations/install.md`, backup: `docs/operations/backup-restore.md`.

### Encrypted web / sync journeys

The Playwright harness builds the application and starts its own API, disposable
database and temporary directories. The default ports are 13000 and 15173; an
occupied port makes startup fail. Do not start `just serve` for these tests.
Prerequisites: Docker Compose, Rust and an installed Playwright Chromium.

```bash
just e2e-recovery
```

Pre-release checklist: `docs/testing/release-checklist.md`.

### Writing-first workspace checks

```bash
pnpm test:ux
```

Runs isolated Chromium checks with synthetic encrypted local vaults (no real
account or synchronization API): search versus editor shortcuts, folder-aware
search, editor focus, recent-note resume, deleted-note recovery after reload,
keyboard dialogs, and responsive layouts from 390 to 1440 pixels. The real
server/offline recovery journeys remain covered by `just e2e-recovery`.

The shared workspace exposes search and new-note actions, recent notes,
folder paths, and backlinks/history independently of the optional assistant.
Only one secondary tool opens at a time; narrow screens use navigation and
tool overlays. Vault creation confirms the local passphrase and explains that
Synapse cannot recover it.

Deletion offers undo and an **Éléments supprimés** view. Recovery uses encrypted
history already present **on this device**, preserves the original path, and
creates an ordinary new encrypted revision. It is not a synchronized trash or
a backup: missing local history cannot be recovered by this interface. See
[ADR 0017](docs/adr/0017-deleted-item-local-history-recovery.md).

### Performance

```bash
node tests/performance/client-benchmark.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --test folder_performance -- --ignored --nocapture
```

These commands measure the Vue/IndexedDB client with 10,000 encrypted notes and
the Markdown replica in a temporary folder. The browser benchmark simulates
network responses: it measures delta processing on the client side. Measurements,
limits and earlier Rust/k6 benchmarks:
[performance budgets](docs/architecture/performance-budgets.md).

### Known MVP limitations

- The Tauri client embeds the encrypted web client through a closed Rust bridge,
  with no generic filesystem or HTTP access from Vue. The local mode allows
  creating and reopening a vault without an account or server. A local vault is
  not sent implicitly when signing in to an account: moving it requires an
  explicit export/import.
- The desktop client also replicates Markdown **in plaintext** into a folder
  chosen with the native picker, or into the default suggested folder. Locking
  the app does not erase those files. Unknown files or files modified outside
  Synapse raise a visible error; their automatic import is not implemented. The
  browser keeps only its encrypted IndexedDB cache and shows no native folder
  picker.
- Every save atomically persists the encrypted content and its operation before
  transport. Signing out keeps that pending encrypted work and purges local
  secrets. Signing back into the same account and unlocking resumes the queue
  until a matching acknowledgement. If local storage refuses the write, the
  draft stays visible and changing note, locking or signing out waits for a
  successful save; the interface surfaces the error.
- An incremental pull precedes the push. WebSocket notifications wake the
  browser; the desktop client uses its authenticated HTTP transport. Automatic
  recovery follows the device delay (10 s by default, configurable 3–60 s), with
  growing and randomized backoff after an error, capped at 60 s. A conflict
  keeps its variants and blocks the relevant operation until resolution in the
  unlocked client.
- No vault content in plaintext reaches the server; the decryption passphrase
  stays local.
- No mandatory SaaS, no remote telemetry. An optional AI assistant chat can run from
  the unlocked client with a user-provided key; the linked notes then go to
  the chosen AI provider (OpenAI, GLM, DeepSeek, Mistral, OpenRouter or a
  custom OpenAI-compatible endpoint), never to the Synapse server (ADR 0008).
  CI does not validate a live AI provider call.
- CycloneDX SBOM: `just sbom` writes under `target/sbom/` (not versioned).
- The web and desktop builds share one update coordinator. The web offers an
  explicit reload; Windows/Linux download a signed Tauri package in the
  background, then offer installation and restart. The first updater-compatible
  binary must be installed manually.

## Roadmap

### Phase 1 — local foundations

- Vault model, Markdown read/write and file watching.
- Editor, preview, tree, backlinks and local search.
- Minimal history and non-regression tests.

### Phase 2 — synchronization service

- Accounts, vaults, authorization and a versioned API.
- Incremental replication, operation queue and conflict handling.
- Docker deployment, backups and baseline observability.

### Phase 3 — web and robustness

- Web client with synchronization and local cache.
- Sharing, roles, audit and usage limits.
- Load testing, security hardening and operations documentation.

### Phase 4 — advanced collaboration

- Real-time editing of a note, presence and optional comments.
- Evolution of encrypted sharing and key management; E2EE of synchronized
  content is already mandatory.
- Extensions/public API, import/export and an isolated plugin ecosystem.

## Initial non-goals

- Binary or protocol compatibility with Obsidian Sync.
- A plugin marketplace before the security model is stabilized.
- Mandatory artificial intelligence, or relaying notes in plaintext through the
  Synapse server. An optional AI assistant chat can run from the unlocked client with
  the user's key (ADR 0008).
- A mandatory dependency on a proprietary cloud service.

## Chosen stack — Vue.js, Rust and open source

The project adopts an **open source, self-hostable stack with no dependency on a
paid service**. Every production component must be runnable on the user's
infrastructure. Any managed services are neither required nor a dependency of
the product.

| Layer                     | Chosen technologies                                                                                                   | License / role                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Desktop client            | **Tauri 2**, **Rust**, **Vue 3**, TypeScript, Vite                                                                    | Tauri (MIT/Apache-2.0), Vue (MIT); lightweight, secure native application |
| Web interface             | **Vue 3**, TypeScript, Vite, Vue Router, Pinia                                                                        | MIT; static SPA served by the server or a reverse proxy                   |
| Design system             | Tailwind CSS or UnoCSS, in-house Vue components                                                                       | MIT; no proprietary UI kit required                                       |
| Markdown editor           | Vditor 3 in IR mode + markdown-it preview                                                                             | MIT; instant CommonMark/GFM rendering, assets bundled locally             |
| Server                    | **Rust**, Axum, Tokio, Tower                                                                                          | MIT; low-footprint HTTP API and real-time synchronization                 |
| API contracts             | OpenAPI, JSON Schema, TypeScript client generation                                                                    | Open standards; versioned and documented protocol                         |
| Real time                 | Secure WebSocket, idempotent operations, delta synchronization                                                        | Open standard; documented application protocol                            |
| Advanced collaboration    | Automerge or yrs/Yjs, only if benchmarks justify it                                                                   | MIT; self-hostable CRDT, no third-party service                           |
| Metadata                  | **PostgreSQL**                                                                                                        | PostgreSQL License; accounts, rights, indexes and sync history            |
| Client storage and search | Encrypted **IndexedDB** and search in unlocked in-memory notes; SQLite/FTS5 remains in the historical Rust components | Local storage; no plaintext content index on the server                   |
| File storage              | Local filesystem by default; **MinIO** for distributed S3-compatible object storage                                   | AGPLv3; fully self-hostable                                               |
| Proxy and TLS             | **Caddy**                                                                                                             | Apache-2.0; automated TLS certificates and reverse proxy                  |
| Containers                | Docker Engine + Docker Compose                                                                                        | Reproducible deployment; compatible Podman/Compose possible               |
| Observability             | OpenTelemetry, Prometheus, Grafana, Loki                                                                              | Apache-2.0/AGPLv3; local metrics, traces and logs                         |
| Local CI                  | Forgejo Actions or Woodpecker CI                                                                                      | GPLv3/Apache-2.0; no mandatory SaaS platform                              |

### Architecture decisions

- **Vue.js rather than React**: Vue 3 is the interface framework shared by the desktop and web clients. It gives the team a consistent component model, good TypeScript ergonomics and a controllable bundle.
- **Rust for the sensitive core**: the synchronization server, the shared vault engine and the critical paths of the Tauri client are written in Rust. This reduces the memory footprint and provides memory-safety guarantees without a garbage collector.
- **Tauri rather than Electron**: the desktop client relies on the native WebView and a Rust binary, to limit distribution size, memory usage and attack surface.
- **PostgreSQL + filesystem by default**: a single server is enough for a personal installation. MinIO is only offered when multiple nodes or object storage are needed.
- **No cloud dependency**: no Firebase, Supabase Cloud, Auth0, Sentry SaaS, Algolia Cloud, Vercel, mandatory GitHub, or any other commercial API on the production path.
- **Open protocols**: HTTP API documented with OpenAPI, documented WebSocket and standard Markdown/JSON formats. Data stays exportable without a proprietary tool.

### License and operational constraints

- Dependencies must be open source and compatible with the project's final license; their license must be verified in CI.
- AGPLv3 components such as MinIO or Grafana are used as standalone services and must not be integrated or redistributed without assessing the corresponding obligations.
- A minimal deployment only requires the Rust server, PostgreSQL, the local file volume and Caddy. Metrics, MinIO and Forgejo are optional.
- External integrations remain optional, disabled by default and replaceable by a self-hosted implementation.

### Rationale

This stack favors open standards, resource frugality and operational autonomy. It
makes it possible to ship a modern Vue.js interface quickly while reserving Rust
for the components where performance, concurrency and security are decisive. The
whole can be distributed as binaries and containers, without a subscription or a
third-party provider account.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first:
test-driven development, small vertical slices, one atomic conventional commit
per green task, and no vault content in plaintext in tests, logs, metrics or
artifacts. This project follows the [code of conduct](CODE_OF_CONDUCT.md).

## Reporting a vulnerability

Do not open a public issue for a security problem: follow the private process
described in [SECURITY.md](SECURITY.md).

## License

Synapse is distributed under the **GNU Affero General Public License v3.0 or
later** (`AGPL-3.0-or-later`) — see [LICENSE](LICENSE). Because the server can be
run as a network service, the AGPL requires making the source code of deployed
modifications available. Dependencies must remain compatible with this license;
CI verifies their licenses and vulnerabilities.
