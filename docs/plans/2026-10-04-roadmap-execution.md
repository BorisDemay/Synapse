# Execution plan for the October 3 roadmap

Date: 2026-10-04. Status: proposed; implementation has not started.

Source: [current roadmap and TODO](roadmap.md), updated 2026-10-03.
This document breaks R01–R10 into executable stages. The roadmap remains the
single authoritative backlog; completion stays there, not in a second checklist.
ADRs remain authoritative. This plan does not approve new trust boundaries,
cryptographic formats, network contracts or operational actions.

## Scope and assumptions

- Cover all ten TODOs, not only the recommended next product feature, R05.
- Preserve the implemented MVP. R01–R04 validate/reconcile existing capabilities;
  they are not instructions to rebuild installation, backup or the assistant.
- Keep R08–R10 as design/evaluation work, not MVP blockers or approved features.
- Repository inspection used HEAD `b7ba4735aabc20ecc8f4dfc346cc7c524d91ff22`
  and the existing uncommitted documentation refresh. Neither was modified by
  this planning task. The recorded CI/release baseline was not independently
  revalidated; no product tests or external calls were run for this plan.
- Clean OS machines, a representative restore target, an update version pair,
  provider credentials and spending limits have not been supplied. Related
  validation remains blocked until its prerequisites and consent are available.
- Work directly in the main session unless delegation is explicitly requested.
  Commits, pushes, deployment, server restarts and production-secret access
  require separate explicit authorization.

## Order and dependency gates

| Stage | Items | Deliverable / gate |
| --- | --- | --- |
| 1 | R03 | Evidence-backed documentation/boundary review; obtain approval for architecture discrepancies before changing them. |
| 2 | R01, R02, R04 | Release-readiness evidence on the selected revision and environments. R04's affected scenarios depend on the R03 boundary decision. |
| 3 | R05 | Approved reconciliation design, then incremental external-Markdown support. Recommended next product feature. |
| 4 | R06, R07 | Separate design approvals, followed by bounded implementations. Neither is bundled into R05. |
| 5 | R08, R09, R10 | Independent design/evaluation reports, only when explicitly prioritized. |

R01 and R02 can be prepared independently of R03; their final procedures must
reflect its conclusions. R05 is not technically dependent on live AI testing.
R06 and R07 are separate tracks, not mutual prerequisites. Their priority may
be revisited after R05 without changing scope silently. Unavailable consent or
infrastructure leaves an item pending; it is not evidence of success.

## Common execution and acceptance rules

1. Read the item's ADRs and applicable `synapse-security`, `synapse-sync` and
   `synapse-delivery` skills. Recheck repository status before edits.
2. For behavior changes: write a focused failing test, observe the intended
   failure, implement the smallest slice, rerun it and the affected suite, then
   refactor only while green. QA-only work reproduces existing behavior;
   design-only work requires a reviewed decision before implementation.
3. Keep plaintext and decryption material off Synapse APIs, databases, blob
   storage and diagnostics. Preserve the existing explicit AI-consent boundary.
4. Persist encrypted edits and operations before transport. Keep operation
   identities stable on retry; remove pending work only after a matching durable
   ack. Preserve conflict variants and pull-before-push behavior.
5. Record date, version/SHA, OS/environment, exact command or scenario, actual
   result and limitations in the [release checklist](../testing/release-checklist.md)
   or [validation history](../testing/validation-history.md), as appropriate.
   Use synthetic data and redact secrets, private URLs and vault content.
6. Check a roadmap item only when all its acceptance evidence exists. A design,
   a mocked test, a partial slice or an earlier green CI run is not completion.

## R03 — Reconcile security and operator documentation

### Steps

1. Build a claim/evidence table: current documentation, governing ADR, active
   runtime entry point, test coverage, observed discrepancy and proposed action.
   Distinguish superseded architecture from current behavior.
2. Audit AI providers/authentication, actual web and native CSP enforcement,
   credential persistence, shared-client/native bridge boundaries, folder
   ownership, update activation/signing, installation and restore procedures.
3. Classify each discrepancy as documentation-only, an intentional limitation,
   or a behavior/architecture question. Do not describe shipped behavior as
   authorized merely because it exists. Escalate security/sync discrepancies
   as blockers and obtain an explicit ADR/plan decision before a code change.
4. Apply approved documentation corrections. If a behavior correction is
   authorized, make it a separate TDD slice with tests for the actual boundary.
5. Recheck cross-references and command definitions. Mark instructions verified
   only after execution on the appropriate environment; retain platform/revision
   qualifications on historical observations.

### Concrete starting points

- `docs/security/hardening.md` and ADR 0008 describe an OpenAI/ChatGPT web
  allowlist. `apps/web/index.html`, `apps/web/nginx.conf` and
  `infra/caddy/Caddyfile` currently use `connect-src 'self' https:`.
  `apps/desktop/src-tauri/tauri.conf.json` remains provider-restricted.
  Review the effective policies and multi-provider requirements; neither
  broadening native permissions nor retrospectively approving broad web access
  is authorized by this plan.
- Trace the shared runtime from `apps/desktop/src/main.ts`, rather than assuming
  similarly named legacy desktop stores/views are the active product.
- Compare `docs/operations/release.md` and `upgrades.md` with ADR 0015,
  `.github/workflows/main-release.yml`, `infra/scripts/update-instance.sh` and
  `deploy-release.sh`; distinguish current pull-based deployment from older
  push-based descriptions.
- Compare `apps/desktop/e2e/README.md` with the actual native recovery harness;
  do not equate a debug harness with published-package clean-install QA.

**Acceptance:** every reviewed claim has a source; discrepancies are resolved or
explicitly blocked pending approval. No hidden trust-boundary expansion and no
unverified command or platform claim presented as verified.

## R01 — Validate clean installation and signed updates

**Prerequisites:** authorized disposable clean Windows/Linux machines; selected
published starting/target versions; a representative test instance and update
feed. No live deployment is changed implicitly.

1. Prepare an OS/package/version matrix, verifying artifact identity, checksums
   and the applicable signatures. Record Windows certificate trust separately
   from successful Tauri updater signature verification; a self-signed test
   certificate is not public trust.
2. Install each published package on a clean machine. Create/reopen/unlock a
   synthetic standalone vault; exercise the native folder picker, packaged
   editor assets, offline edit and encrypted-cache recovery.
3. For synchronized vaults, make durable offline edits before the update. Run a
   real ascending signed update, explicitly install/restart, verify version/SHA
   parity and reconnect. Confirm notes survive and pending operations remain
   recoverable until acknowledged. Check standalone data also survives.
4. Exercise failed/interrupted download and invalid-signature handling in the
   disposable setup. Confirm the editor and encrypted outbox remain usable.
5. Exercise supported server/web rollback and desktop downgrade rejection.
   Never promise native downgrade: ADR 0015 requires an ascending corrective
   release. Record manual recovery steps and observed limitations.

**Primary files:** `docs/operations/{release,upgrades,rollback}.md`,
`apps/desktop/src-tauri/src/updater.rs`, `apps/desktop/src/update/`,
`apps/web/src/update/`, `tests/release/`, `tests/e2e/update-ready.spec.ts`,
`tests/e2e/offline-update.spec.ts` and `apps/desktop/e2e/`.

**Acceptance:** actual published-package results on both OS targets, a real
signed update on each, preserved data/outbox, truthful failure feedback and
supported rollback evidence. Native debug CI alone does not close R01.

## R02 — Validate restoration for the target deployment

**Prerequisites:** operator-approved environment characteristics and an isolated
Compose project, volumes and ports. Prefer synthetic representative backups;
production backup/secret access needs separate approval. Backup and restore
scripts can stop services and replace data: authorize their target explicitly.

1. Specify the target topology, storage/permissions, versions/migrations,
   expected data volume and client unlock method. Document differences between
   the disposable environment and the intended deployment.
2. Reuse the existing backup/restore automation. Create a synthetic encrypted
   vault, notes and attachments with known client-side integrity expectations;
   take a verified PostgreSQL/blob backup from the disposable source.
3. Restore into a separately isolated target. Check manifest integrity,
   database/migration compatibility, blob completeness and service health.
   Verify corrupt, incomplete and unsafe backup inputs fail closed.
4. Reopen through an actual client using user-held unlock material; verify note
   and attachment content locally, then edit and synchronize with another client.
   Exercise an offline client's return without assuming old cursors or pending
   operations can be discarded after restoration.
5. Record the operator procedure, observed duration, failure/retry instructions
   and compatibility limits. Server backup restoration does not recover a lost
   passphrase or local-only assistant conversations and snapshots.

**Primary files:** `infra/scripts/{backup,restore}.sh`,
`infra/scripts/backup_manifest.py`, `tests/operations/backup_test.py`,
`tests/integration/backup_restore.sh`, `docs/operations/backup-restore.md`.

**Acceptance:** successful target-representative restore and client reopening,
negative integrity checks and a reproducible operator procedure. Existing CI
restore evidence is useful baseline coverage, not a substitute for this drill.

## R04 — Validate optional AI providers

**Prerequisites:** explicit consent for each external destination/authentication
mode, operator-supplied credentials, synthetic notes and agreed call/cost limits.
Resolve relevant R03 CSP/transport discrepancies first; never add a Synapse proxy
or relax policy just to make a provider pass.

1. Derive the matrix from `apps/web/src/ai/providers.ts`: ChatGPT device login,
   OpenAI API key, GLM, DeepSeek, Mistral, OpenRouter and one explicitly selected
   compatible custom endpoint. Record web versus actual Tauri outcomes and
   model/API mode; do not claim arbitrary custom endpoints are validated.
2. Verify setup, model discovery/fallback and consent boundaries. Only explicitly
   selected note context leaves the client; save failure prevents sending it.
3. Test streaming, one structured write action, create/replace/append scope,
   cancellation, authentication/network failures and truthful completion feedback.
   Reopen to verify an accepted mutation was durably saved and encrypted.
4. Record naturally observed refusals or provider errors. Use existing
   deterministic fixtures for malformed/refused responses and other cases that
   cannot reliably be induced live; label them as mocked, never live evidence.
5. Remove test credentials through the supported workflow, verify lock/logout
   purges in-memory secrets, and record tested/skipped/blocked cases without
   exporting tokens or note content. Keep ordinary CI offline and deterministic.

**Primary files:** active `apps/web/src/ai/` and `stores/assistant.ts`,
`crypto/ai-credential.ts`, `components/QuickAssistantPrompt.vue`, corresponding
specs, and desktop transport/CSP entry points. Check both code paths where
applicable without treating duplicated files as proof of runtime coverage.

**Acceptance:** provider/auth/platform results with explicit coverage gaps, no
unconsented transmission or false mutation success. Missing consent leaves the
relevant validation pending, not passed.

## R05 — Reconcile external Markdown edits on desktop

### R05.1 — Approve the reconciliation design

Update [ADR 0013](../adr/0013-desktop-folder-replica-and-server-priority.md) and
`docs/security/desktop-folder-recovery.md` before changing ownership rules.
Preserve ADRs 0011, 0016 and 0018: encrypted shared-client state is canonical;
standalone vaults emit no network operations; independent changes do not inherit
an editor draft's causal base.

Resolve these design questions explicitly:

- How a mirrored path maps to a stable note identity and an encrypted baseline.
  The current manifest stores only owner plus path/hash history; it does not
  identify notes or retain the merge base. Sparse seven-day recovery snapshots
  cannot be assumed to supply a reconciliation base indefinitely.
- Which external changes are automatically accepted after opt-in, which require
  confirmation, and how unknown files are explicitly adopted. Never silently
  claim or overwrite another vault's directory.
- How to persist reconciliation identity/progress and preserve an external
  candidate before a concurrent local save or remote pull can destroy it.
  The native journal and IndexedDB cannot be assumed to share a transaction.
- How to distinguish true renames, case-only renames, copies and ambiguous
  create/delete pairs on both OSes. Do not infer identity solely from timestamps
  or equal content; ambiguous cases require explicit resolution.
- Lock/logout/account-switch behavior, watcher lifetime, event coalescing,
  overflow/rescan recovery, and conflicts involving unsaved editor drafts.
- How to classify confirmed deletion versus transient missing files, atomic
  editor-save sequences, permission errors or an unavailable folder.

No attachment reconciliation, generic filesystem API or new sync protocol is
included. Existing attachment mirroring must keep working unchanged.

### R05.2 — Add bounded, read-only discovery

- Start with tests for a changed owned `.md` file and an unknown `.md` file.
  Discovery reports candidates without rewriting either file or canonical state.
- Add a closed native scan/read boundary scoped to the bound vault root. Enforce
  existing path and size limits; reject traversal, symlinks/reparse-point escapes,
  reserved paths, case collisions and invalid input. Revalidate at consumption
  to handle scan/read races.
- Represent ignored/unsafe/ambiguous candidates and errors in a desktop-only
  interface. No native picker, scan or watcher is introduced in the browser.

### R05.3 — Import explicit creation and modification

- First vertical slice: a confirmed modification of one owned note while
  unlocked becomes one durable encrypted local mutation. A repeated scan or
  interrupted retry creates no duplicate mutation and no watcher echo loop.
- Route changes through the shared vault store and existing encryption/outbox
  logic. Preserve independent editor, external and remote variants with their
  actual bases; use safe client-only merge where justified, otherwise resolve
  manually. Missing base information must not trigger blind overwrite.
- Add explicit adoption of an unknown valid Markdown file as a new note with
  locally assigned identity. Test path collisions and storage refusal.
- Verify standalone mode remains network-free; synchronized mode survives
  offline restart and resumes the same pending work on reconnect.

### R05.4 — Add rename and deletion

- Implement the approved identity-preserving rename path, including case-only
  changes and destination collisions. Leave ambiguous events unresolved rather
  than guessing.
- Implement confirmed external deletion through ordinary encrypted tombstones
  and pre-delete recovery capture. Test delete-versus-edit and delete-versus-
  remote-update conflicts, cancelled actions and transient file disappearance.
- Test interruption between native discovery, encrypted persistence and manifest
  completion. Resume safely without losing a variant or duplicating an operation.

### R05.5 — Integrate background detection and UX

- Add the approved opt-in watcher or bounded polling strategy behind the native
  adapter, reusing an existing suitable facility before adding a dependency.
  Any new dependency requires role/license justification.
- Treat events as hints; reconcile against validated state. Coalesce duplicates,
  ignore verified self-writes, rescan on restart/overflow and bound work so large
  vaults do not block editing.
- Stop/discard stale work on lock, logout, folder change and vault switch; rescan
  after unlocking. Do not persist new plaintext candidate caches or leak content
  through events, logs or errors.
- Expose pending imports/conflicts and actionable failures with keyboard/focus
  coverage. Avoid rewriting unrelated files during an unresolved reconciliation.

### R05.6 — Validate and document

**Primary files:** `apps/desktop/src-tauri/src/{local_folder,commands,lib}.rs`,
`apps/desktop/src/platform/local-folder.ts`, `apps/desktop/src/main.ts`,
`apps/web/src/platform/local-folder.ts`, `apps/web/src/stores/vault.ts`,
`apps/web/src/offline/`, `apps/web/src/views/LocalFolderPanel.vue` and
`crates/synapse-core/`. Reuse import validation where appropriate; the existing
`apps/web/src/import/apply.ts` is not itself a concurrency-safe reconciler.

**Test anchors:** native `tests/local_folder.rs` and `tests/commands.rs`, both
platform adapter specs, shared `stores/{durability,edit-provenance,local-mode}.spec.ts`,
new focused reconciliation specs and the native Windows/Linux recovery harness.

**Acceptance:** creation, modification, rename and deletion work on both target
OSes; unknown files need explicit adoption; unsafe paths fail closed; concurrent
variants survive; duplicate events/crashes do not duplicate operations; offline
restart/reconnect works; locking never erases the plaintext replica or causes an
empty mirror snapshot. Measure large-vault behavior against the existing native
folder baseline without inventing universal latency promises.

## R06 — Cross-account E2EE vault sharing

1. **Design gate:** approve a threat model and ADR covering account/device key
   identity and verification, invitations, roles, encrypted key distribution,
   rotation, revocation, ownership transfer and member/account deletion.
   Define behavior for an offline member with pending edits and for old clients.
   Explicitly state that revocation cannot erase already decrypted copies.
2. **Contract/data slice:** only after approval, add versioned contracts and
   additive migrations for the accepted model. Existing `vault_members` and
   envelope tables are scaffolding, not proof of implemented E2EE sharing.
3. **Authorization slice:** enforce the approved permissions on every relevant
   read/write, envelope, blob and notification route. Test unaffiliated users,
   reader writes, forged/replayed invitations and stale/revoked membership
   against a real disposable PostgreSQL instance.
4. **Client slice:** implement local invitation acceptance and audited key
   handling through existing crypto boundaries, then ordinary shared-vault
   read/edit/sync. Keep server storage opaque; no plaintext key recovery shortcut.
5. **Lifecycle slice:** implement approved rotation/revocation and interrupted
   transitions; test multiple accounts, devices, concurrent writers and offline
   return before documenting the feature as available.

**Primary files:** `docs/security/`, `docs/adr/`, `crates/synapse-crypto/`,
`crates/synapse-protocol/`, `apps/server/src/{repository,http,sync}/`,
`migrations/`, `apps/web/src/{crypto,stores,offline}/`,
`apps/server/tests/vault_authorization.rs` and multi-client E2E tests.

**Acceptance:** reviewed key lifecycle plus adversarial multi-account evidence,
not merely invitations or an admin role. Do not implement speculative crypto
while waiting for the design decision.

## R07 — Larger encrypted attachments

1. **Design gate:** approve intended sizes, memory/concurrency budgets and a
   versioned streamed upload/download/resume contract. Select a reviewed
   cryptographic construction behind `synapse-crypto`; specify how integrity,
   ordering, truncation, replay and item identity are authenticated without
   inventing ad hoc framing. Define client compatibility and migration behavior.
2. **Server slice:** implement authorized opaque transfer staging, bounded
   storage/quota enforcement, resume and idempotent finalization. Only acknowledge
   a published item once required ciphertext is durable. Define abandoned-upload
   cleanup without deleting active or referenced data.
3. **Client slice:** implement bounded encryption/upload and verified
   download/decryption on web and desktop, persistent resume metadata, progress,
   cancellation and restart recovery. Keep names, paths and MIME metadata encrypted.
4. **Failure slice:** test disconnects at each stage, lost acknowledgements,
   duplicate/reordered/tampered data, quota exhaustion, concurrent transfers and
   cleanup races. Verify memory bounds under realistic large files.
5. Update ADR 0010, the protocol schema/API client, operator limits and backup/
   restore coverage after the approved implementation is validated. Keep current
   small-item compatibility; never solve this by increasing the JSON push cap.

**Primary files:** `apps/web/src/crypto/vault-item.ts`, shared vault store/outbox,
`apps/desktop/src-tauri/src/http.rs`, `crates/synapse-{crypto,protocol,sync}/`,
`apps/server/src/{http/sync.rs,sync/apply.rs,blob}/`, storage migrations and
`tests/integration/backup_restore.sh`.

**Acceptance:** authenticated end-to-end transfer/resume and download, bounded
memory, quota/authorization enforcement, replay-safe acknowledgements and cleanup,
with interrupted-transfer and restoration evidence.

## R08–R10 — Later design studies

| Item | Bounded work | Exit artifact / implementation gate |
| --- | --- | --- |
| R08: real-time collaboration | Define actual collaboration needs and offline semantics; compare maintained open-source CRDT candidates using representative Markdown, conflict and memory/latency workloads. For cross-account use, align with R06's approved key/membership model. | A measured recommendation, including “defer/no CRDT” if warranted; preserved Markdown export and client-only plaintext merging. Implementation requires a separate approved ADR/plan. |
| R09: restricted extensions | Enumerate extension capabilities and threat boundaries; evaluate isolation, explicit grants, compatibility/versioning, disable/recovery behavior and hostile extension scenarios. | Reviewed permission/isolation design and acceptance tests to implement later. No default filesystem/network/key access; no marketplace or package loading in this task. |
| R10: lost-passphrase recovery | Compare user-controlled opt-in recovery options using audited primitives; define required pre-established material, enrollment, storage, revocation and failure cases. Assess interactions with trusted devices, backups and any R06 key lifecycle. | Reviewed threat model and recovery UX/design; clearly state that losing all decrypt/recovery material remains unrecoverable. No implicit escrow or recovery implementation before approval. |

## Validation entry points for execution

These commands exist in the current repository; they are future entry points,
not results obtained during planning. Start with focused tests, then the affected
suite and applicable static checks. Add new focused targets as slices introduce
new tests. Do not run every row for an isolated documentation or UI change.

| Area | Existing entry points |
| --- | --- |
| Release automation | `node --test tests/release/*.test.mjs` |
| Operations unit tests | `python3 -m unittest tests/operations/backup_test.py` |
| Authorized disposable restore/deployment drills | `bash tests/integration/backup_restore.sh`; `bash tests/integration/release_drill.sh` |
| Native folder boundary | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test local_folder`; same command with `--test commands` |
| Desktop adapter | `pnpm --filter @synapse/desktop test src/platform/local-folder.spec.ts` |
| Shared client provenance/durability | `pnpm --filter @synapse/web test src/stores/durability.spec.ts src/stores/edit-provenance.spec.ts src/stores/local-mode.spec.ts` |
| Shared assistant | `pnpm --filter @synapse/web test src/ai/codex-client.spec.ts src/ai/codex-oauth.spec.ts src/stores/assistant.spec.ts src/components/QuickAssistantPrompt.spec.ts` |
| Changed client package gates | `pnpm --filter @synapse/web test`; `pnpm --filter @synapse/web typecheck`; `pnpm --filter @synapse/web lint` (use `@synapse/desktop` for its package) |
| Protocol/security/storage changes | `cargo nextest run -p synapse-crypto -p synapse-protocol -p synapse-sync -p synapse-server`; dedicated disposable PostgreSQL required for server integration tests |
| Real-API conflict/recovery | `pnpm exec playwright test tests/e2e/full-sync.spec.ts tests/e2e/conflict-resolution.spec.ts`; `just e2e-recovery` for the broader recovery gate |
| Native Windows/Linux acceptance | `pnpm --filter @synapse/desktop test:e2e:native`; Linux headless: prefix with `dbus-run-session -- xvfb-run -a` |
| Native folder performance | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test folder_performance -- --ignored --nocapture` |

For security/protocol implementation, also apply the security/sync skill's
integration, redaction, static and dependency/license gates. Use temporary test
profiles and databases, never development/production data. Browser and native
harnesses must own their test services; do not restart existing servers.

Reserve `just verify`, full builds and cross-platform release validation for the
appropriate merge/release preparation or explicitly approved feature acceptance.
Do not confuse any automated gate with R01 published-package QA or R04 live calls.

## First executable task

Start with **R03's claim/evidence table**, beginning with CSP and the actual
multi-provider runtime. It is bounded, needs no credentials or server restart,
and identifies decisions that would otherwise invalidate later QA. If the
priority is feature development instead, start **R05.1's ADR design**, not a
watcher implementation. Both can be reviewed before authorizing product changes.
