# Reliability completion — seven reviewed gaps

Requested on 2026-09-08. This supplements the original implementation plan;
its E2EE and synchronization invariants remain authoritative.

Development uses GPT-6 Astra at low reasoning effort. Independent review uses
GPT-6 Astra at medium effort. Reviewers send acceptance or required changes
directly to developers; the orchestrator integrates and verifies the result.

## Acceptance ledger

1. Durable saves: atomically persist encrypted content and the pending operation
   before transport. Editing does not wait for the network. HTTP rejection,
   timeout, interrupted acknowledgement and concurrent saves preserve operations;
   only matching acknowledgements remove them.
2. Safe logout: purge in-memory plaintext/keys and trusted unlock credentials,
   retain encrypted unsynchronized content, and prevent late async work from
   restoring a locked or previous user's state. Device erasure is explicit.
3. Automatic sync: shared serialized coordinator, persisted incremental cursor,
   pull before push, bounded retry with jitter, browser WebSocket wakeups and a
   closed native transport or polling fallback. No blind same-note rebasing;
   conflicts retain base, local and remote variants across restart.
4. Desktop folders and standalone use: install the native adapter, real folder
   selection, durable validated Markdown replica, no OS picker in the browser,
   and create/unlock/edit/reopen a local vault without an account or server.
   [ADR 0016](../../docs/adr/0016-standalone-encrypted-desktop-vaults.md) defines
   the local authorization/storage boundary; account migration stays explicit.
5. Recovery: consistent backup, complete manifest verification before destructive
   restore, strict copy/dump/restore errors, corruption and missing-file tests,
   and a real isolated PostgreSQL/Compose restore exercise.
6. Actual-client performance: reproducible 10,000-note browser measurements for
   open/edit/search/reconnect; indexed encrypted cache reads, lazy history and
   incremental search processing as justified by measurements. Keep plaintext
   indexes local to the unlocked client and purge them on lock.
7. Release evidence: isolated test services; browser and real native editing,
   restart, reconnect, conflict and restoration tests; Windows/Linux CI jobs;
   documentation distinguishes observed results from CI-only targets.

## Execution constraints

- Unrelated services occupy localhost ports 3000, 5173 and 8080. Use isolated
  ports and disposable database/project names; do not stop those services or
  run destructive tests against `synapse_dev`.
- Existing `.worktrees/` content belongs to earlier work and is left intact.
- Shared checkout edits have explicit file ownership. Commit only the current
  task's files after targeted validation and independent review.
- No deployment or publication is needed for these repository changes.
- Update ADRs when completing a feature requires a new architecture decision.

## Validation evidence

Initial baseline: `cargo nextest run --workspace` passed 174 tests against the
test PostgreSQL. Earlier analysis passed 337 JavaScript tests, all frontend
typechecks, 28 crypto/protocol/sync Rust tests and 7 release tests. Those results
do not validate these seven gaps. Completion needs new tests and observations
recorded in the release checklist and relevant operator documentation.

- Points 1–2: commit `f0b9492`, approved by the independent medium reviewer
  after 48 focused tests; developer observed 147 web tests and typecheck green.
- Point 5: commit `a6f77cc`, approved by the same reviewer; 11 focused Python
  tests and the real isolated Compose backup/restore scenario passed, including
  corruption rejection and restoration after volume destruction.
- Point 4: shared local mode `9a2f7fd` and desktop folder integration `d7d8cb7`
  approved by the medium reviewer; 13 native folder tests, 3 adapter tests and
  fresh-store local reopening without remote authentication were observed.
  Native end-to-end evidence remains part of point 7. The editor accessibility
  correction `a25d21e` passed 18 component tests after reproducing the hidden
  editor label failure in a real browser.
- Point 3: `2e6f398` approved by the medium reviewer after independent
  incremental-pull/coordinator tests, including durable blocked conflicts,
  missing-base history proof, invalid-cursor reset and cyclic-pagination
  rejection. `58cc3cc` connects automatic synchronization to the native folder
  adapter, with four independently observed adapter tests.
- Point 6: `8cf9fe2` approved by the medium reviewer. Actual encrypted 10,000-note
  client open measured 812 ms after an original >30 s timeout; search p95
  22.4 ms, durable UI edit including debounce 1,004 ms and a full reload verified.
  An encrypted incremental delta applied from the persisted cursor in two GETs
  (1,432 ms, mocked transport). Native temporary-folder creation/unchanged/edit
  measured 22,459/1,519/1,870 ms. The performance document explicitly records
  the remaining 650 ms tree-render task, development-build conditions and
  non-comparable historical memory-only measurements.
- Native release testing exposed an existing remembered-session origin leak.
  `7465ea5` fixes it with versioned origin-bound records, rejection of legacy
  unbound tokens and isolated deletion across origins. The medium reviewer
  observed seven HTTP/session tests, including a real request proving that a
  different origin receives no old cookie. ADR 0014 records the boundary.
- Point 7: shared browser recovery `86282bc`, native CI `ca61d92`, conflict
  workspace regression `8645022` and native runner `3afb543` are independently
  approved. Eight built-browser scenarios passed together: registration and
  activation, offline edits, full browser-process offline reopening, failed
  delivery across logout/relogin, identical lost-ack replay, live propagation,
  conflict/history recovery and continuity across two application versions.
  Additional unit tests retain drafts and block leaving when IndexedDB rejects
  a save, and preserve the revision of a draft during incoming changes.
  The native runner passed twice on Linux, including the medium reviewer's
  independent execution: actual OS picker cancellation/selection, UI editing,
  full process restart, encrypted offline queue recovery, authenticated remote
  changes, physical conflict-resolution click and matching acknowledgement.
  Attachment/history store actions additionally verified real replica bytes.
  Windows/Linux jobs run the native scenario before release builds; Windows
  configuration is reviewed but Windows execution has not been observed here.
- Final integrated `just verify` exited 0 with `just verify: all gates passed`:
  174 workspace Rust tests, 27 native Rust tests, 390 JavaScript tests, seven
  lifecycle tests, eight release tests, eleven operation tests, all type/format/
  clippy/audit gates, eight built-browser recovery scenarios and both real
  isolated Compose restart/backup-restore drills. One opt-in filesystem
  benchmark is intentionally outside the default Rust test suite and was run
  explicitly for point 6. All seven requested implementation areas are complete
  and independently reviewed; Windows runtime evidence remains a CI-only check.
- Post-integration native Rust check: 27 tests passed, one opt-in filesystem
  benchmark ignored by the default test command. Workspace formatting and clippy
  passed; seven release-script tests and eleven backup-operation tests passed.
  These do not replace the actual native WebDriver run required by point 7.
- Initial actual-client Chromium measurement (synthetic 10,000-note in-memory
  fixture, about 1 KiB/note): search median 10.7 ms, p95 14.5 ms over 20 queries;
  route render 615 ms, 10,000 tree items and 60,101 DOM elements. This is a
  diagnostic baseline, not the encrypted-cache open/reconnect benchmark.
