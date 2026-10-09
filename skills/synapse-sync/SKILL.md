---
name: synapse-sync
description: Implement encrypted, offline-first sync safely.
version: 0.1.0
author: Project maintainer, Hermes Agent
license: AGPL-3.0-or-later
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [synapse, synchronization, offline-first, conflicts, rust]
    related_skills: []
---

# Synapse Synchronization

Use this skill for sync protocol, local queue, cursors, WebSocket notifications, offline recovery, conflict detection, or revision history. The product is local-first: a network failure must never make a local edit unavailable.

## When to Use

- Editing `crates/synapse-protocol/`, `crates/synapse-sync/`, local queue storage, server sync handlers, cursors, blobs, WebSocket code, conflict UI, or synchronization E2E tests.
- Do not use it to add CRDTs or shared encrypted vaults: both are explicitly outside the MVP.

## Invariants

- Every mutation has a globally unique `operation_id`, a `base_revision`, a vault reference, and an idempotent server result.
- An ack removes an operation from the local queue only after a durable server response.
- Push/pull messages carry encrypted payloads. The server never parses Markdown or performs plaintext merges.
- Pull uses a stable, paginated cursor. A client can replay after a crash, reconnect, duplicated delivery, missed WebSocket notification, or restart.
- WebSocket is a wake-up signal, not the durable source of truth. On any reconnect the client pulls from its cursor.
- A stale base revision creates a conflict that keeps base, local, and remote variants. A client may merge only disjoint changes after decrypting all variants; overlapping changes require explicit user resolution.

## Procedure

1. Identify the one vertical behavior: queue write, push, idempotent replay, pull page, reconnect, notification, stale revision, or manual resolution.
2. Write a failing test against real protocol/storage code. Include the expected revision, cursor and operation identity. Completion: it fails specifically because the behavior is absent.
3. Implement the smallest state transition. Completion: all status transitions are explicit and persisted.
4. Add an interruption test: network timeout, process exit between push and ack, duplicated operation, stale cursor, or simultaneous writer. Completion: no test loses an operation or silently overwrites content.
5. Add authorization and opaque-payload tests at the HTTP boundary. Completion: another user cannot pull or push a vault; server fixtures have no Markdown.
6. Run the focused test, crate suite, server integration suite, and the relevant E2E test. Completion: every result is green before refactoring or committing.

## Pitfalls

- Do not use timestamps as conflict ordering or idempotency keys; clocks drift.
- Do not make a notification equivalent to receipt. Notifications can be lost, duplicated, reordered, or delayed.
- Do not mark a sync success before the database transaction and blob availability are durable.
- Do not delete conflict variants during resolution; a resolution creates a new revision.
- Retry must be bounded with jitter and must not run on the UI thread.

## Verification

```text
cargo nextest run -p synapse-protocol -p synapse-sync -p synapse-server
pnpm playwright test tests/e2e/full-sync.spec.ts tests/e2e/conflict-resolution.spec.ts
```

For each implementation, capture evidence for offline edit → restart → reconnect → pull/replay and for two concurrent edits to the same note.
