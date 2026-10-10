# Synapse — historical validation evidence

These are dated observations retained from retired plans and the former release
checklist. They are not open tasks and do not certify the current revision.
Current readiness is tracked in the [release checklist](release-checklist.md);
future work belongs to the [current roadmap](../plans/roadmap.md).
No commands below were rerun as part of the documentation reset.

## 2026-10-03 — CI baseline

Commit `b7ba4735aabc20ecc8f4dfc346cc7c524d91ff22` passed
[run 37159224532](https://github.com/BorisDemay/Synapse/actions/runs/37159224532):
code verification, recovery, self-hosting, web E2E, native recovery and signed
bundles on Windows/Linux, images and publication.
[Release v0.1.157](https://github.com/BorisDemay/Synapse/releases/tag/v0.1.157)
was published for this commit. This does not attest to later revisions or to a
manual fresh-install/update test on an end-user machine.

During the preceding dependency/helper corrections, targeted local UI, web and
desktop suites passed with 337, 485 and 183 tests respectively; the harness had
13 passing tests and `just e2e-recovery` had 12. These counts describe that earlier
state, before subsequent AI-response validation changes.

The asset-path correction committed as `c9163f0` was validated locally with
15 harness tests and 12 real-server E2E journeys, web/desktop typechecks and lint,
and a clean JavaScript audit. Its new tests observed the real Vditor loader
requesting local `/vendor/vditor/dist/...` assets in both Vite configurations.
Those Chromium observations were not native Windows runtime tests.

## 2026-09-22 — writing-first

The retired writing-first plan reported these results after its integration:

- `pnpm test`: 660 tests (API client 2, UI 238, web 307, desktop 113).
- `pnpm typecheck` and `pnpm lint`: passed.
- `pnpm test:ux`: 14 real-browser checks covering editor shortcuts, search,
  dialogs/focus, resume, deletion/recovery, navigation and responsive layouts.
- `just e2e-recovery`: 10 real-API/PostgreSQL journeys, including restoration
  synchronizing to a second client as a new encrypted revision.
- Native Linux under `dbus-run-session`/`xvfb-run`: picker selection/cancellation,
  local vault creation, edit/restart, Markdown replica, attachments, history,
  offline reconnect and conflicts. Windows was not tested in that local run.
- The 10,000-note client benchmark verified reopening and incremental processing,
  80 rendered tree rows and 593 DOM elements. The fixed-control budget was
  documented in [performance budgets](../architecture/performance-budgets.md).

The baseline had reproduced five UI regressions and an existing Settings test
failure before the corrections. Reviews then covered interaction/layout,
onboarding, workspace and recovery. No new runtime dependency, server protocol
or cryptographic primitive was introduced by that work.

The decisions remain in ADRs 0017 and 0020; deleting the old plan does not remove
local-only recovery limits, sparse snapshots or durable navigation guards.

## 2026-09-22 — causal autosave bases

The retired autosave-conflict plan reported results after the writing-first stage:

- `pnpm test`: 670 tests, including local lineage, independent mutations and
  another tab sharing IndexedDB; types and lint passed.
- `pnpm test:ux`: 14 browser checks.
- `SYNAPSE_E2E_UI_PORT=15183 SYNAPSE_E2E_API_PORT=13010 just e2e-recovery`:
  11 journeys against real PostgreSQL/API on isolated free ports.
- Native Linux smoke: local creation, picker cancellation, restart, offline
  reconnect, conflicts, history and attachments. No native Windows observation
  was claimed for this local run.

The reproduction retained an ACK while starting the next draft, then observed a
false conflict before correction. Coverage included an ACK during persistence,
attempted-operation replay, remote/independent changes and invalid session/note
provenance. ADR 0018 retains the decision: only ACKs in the draft's own lineage
can advance its base, and an already attempted ciphertext remains identical.
Existing conflicts were not erased or resolved retroactively.

## 2026-09-17 — continuous release and deployment

The former checklist recorded:

- 57 release tests for parity, SemVer, SHA, immutable URLs, signatures, workflow
  and deployment; desktop updater signatures checked after bundling and again
  before publication.
- Workflow `35256069995`, SHA `5f0da27`, published `v0.1.32`, including Windows
  signing and bundling. Its self-signed test certificate bypassed Authenticode
  trust verification; that is not evidence of a publicly trusted installer.
- A NAS bootstrap to `0.1.33`, SHA `da048ad3…`, with matching health/build/update
  versions and active release/image pointers, was observed on that date.
  The authenticated updater and 15-minute timer subsequently reported success.
  This is historical deployment evidence, not a current NAS inspection.
- Manifest parity/rollback checked by 31 deployment tests and the isolated real
  Compose/TLS release drill; the drill observed migration backup, manifest-last
  activation and rollback of images and release pointers.
- The built-web update notification was observed in Chromium. Desktop clients
  shared the coordinator; native execution was established separately by CI.

## 2026-09-08 — reliability review

On the Linux/WSL2 reference machine, the previous checklist recorded:

- `just verify: all gates passed` with exit code 0.
- Rust formatting/clippy and 174 workspace tests with real PostgreSQL; 27 native
  Rust tests, including 13 folder-replica and 7 session/transport tests.
- 392 JavaScript tests, 7 harness tests, 9 publication tests, 11 Python operations
  tests, frontend types/format and complete dependency audits.
- A bounded local security regression with 31 HTTP/browser/WebSocket checks and
  zero findings for those checks, not a general security certification.
- Client/replica benchmarks described in the dated
  [performance budgets](../architecture/performance-budgets.md).
- Self-hosting restart and backup/restore tests on disposable Compose projects.
  Restore destroyed only its own disposable volumes, verified ciphertext/nonce
  after restoration, and rejected incomplete/altered archives before destructive
  operations. Existing development projects were not used.
- Nine built-application recovery journeys and two successful native Linux runs,
  including reconnect, conflict ACKs and replicated-byte checks.

Separate Windows evidence was recorded in workflow `34654442136`, SHA
`8cd941c565ce584fe4eeddaed6a5ec2686fe6d72`, native job `103443659815`.
A WSL2 run was never treated as a Windows WebView observation.

## 2026-09-27 — quick-assistant plan retirement

The retired quick-assistant plan specified active-note consent, a fresh thread,
durable save before external transfer, generic progress/error feedback, stale
session cancellation and reset of busy state after persistence failures. It did
not contain an attached command-result report. These requirements remain part of
the client/security documentation and tests; no live-provider validation is
inferred from retiring the plan or from mocked tests.
