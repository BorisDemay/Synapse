# Synapse — current roadmap and todo

Updated: 2026-10-03. This is the only active product plan and replaces the previous
implementation plans. ADRs remain authoritative; historical test results live in
[validation history](../testing/validation-history.md), not in the backlog.

## Verified baseline

The encrypted local-first MVP is implemented: shared web/desktop editing, local
vaults, search, attachments, operation-based synchronization, explicit conflicts,
local recovery, self-hosting, backup/restore tooling and signed updates.

For commit `b7ba4735aabc20ecc8f4dfc346cc7c524d91ff22`,
[CI run 37159224532](https://github.com/BorisDemay/Synapse/actions/runs/37159224532)
passed all verification, native Windows/Linux, bundle and publication jobs.
[Release v0.1.157](https://github.com/BorisDemay/Synapse/releases/tag/v0.1.157)
was published. This is evidence for that revision, not a guarantee for later
changes or an independent inspection of every deployed installation.

The product remains pre-release. Multi-user accounts do not imply cross-account
vault sharing. Local recovery snapshots are not backups or lost-secret recovery.

## Priorities and open todo

Every unchecked item is pending. R01–R04 are release-readiness work, R05–R07 are
product gaps, and R08–R10 are later explorations, not MVP release blockers.
Documentation/status refresh performed for this reset is complete; R03 is the
remaining cross-document architecture/security review, not another roadmap reset.

### Release readiness

- [ ] **R01 — Validate clean installation and updates on Windows and Linux.**
      Install published packages on clean machines, validate signing/trust, then
      exercise a real signed update, restart, version parity and supported rollback.
      Verify local notes and pending edits survive. A self-signed test certificate
      must not be reported as a publicly trusted Windows signature. Record OS,
      version/SHA and actual results in the [release checklist](../testing/release-checklist.md).
- [ ] **R02 — Validate restoration for the target deployment.**
      Restore encrypted PostgreSQL/blob backups into a disposable environment
      representative of the target, verify integrity and client reopening with
      user-held unlock material, and document the operator procedure. Do not destroy
      a live deployment or retrieve production secrets without explicit approval.
- [ ] **R03 — Reconcile remaining security and operator documentation.**
      Audit shipped client behavior against ADRs, CSP descriptions, multi-provider AI
      boundaries, installation and update instructions. Separate obsolete descriptions
      from intentional limits. Any architecture discrepancy requires an explicit
      reviewed ADR/plan change; this backlog does not approve a wider trust boundary.
      Keep measurements tied to revisions and OS-specific evidence.
- [ ] **R04 — Validate optional AI providers with live smoke tests.**
      With explicit consent and operator-supplied credentials, test supported
      providers/authentication modes using synthetic notes only: streaming, tool
      calls, refusals, malformed responses, cancellation and failure feedback.
      Keep deterministic mocked CI coverage; do not add mandatory accounts, paid
      services, credentials in source, or automatic external calls to ordinary CI.

### Next product features

- [ ] **R05 — Support external Markdown edits on desktop.**
      Design reconciliation for files changed by another editor, then implement small
      tested slices for creation, modification, rename and deletion. Preserve the
      encrypted client as canonical; reject unsafe paths/symlinks, prevent watcher
      loops, distinguish owned and unknown files, and never silently overwrite
      either variant of concurrent work. Validate offline restart/reconnect and
      Windows/Linux filesystem behavior. Update ADR 0013 before changing its ownership
      and reconciliation rules. This is the recommended next product feature.
- [ ] **R06 — Design and implement cross-account E2EE vault sharing.**
      First approve the threat model and ADR for invitations, roles, key distribution,
      rotation and revocation. State the limits of revocation for content already
      decrypted by a former member. Then implement authorization and client key
      handling with existing audited crypto boundaries, ciphertext-only server
      storage, and multi-account adversarial tests. Do not treat current instance
      administration roles as implemented vault sharing.
- [ ] **R07 — Support larger encrypted attachments.**
      The current item limit is 10 MiB. Approve a bounded streamed upload/resume
      contract before implementation; preserve opaque server storage, authenticated
      encryption, idempotency, quota enforcement and explicit acknowledgements.
      Cover interrupted transfers, tampering, retry, cleanup and bounded memory.
      Do not merely raise the JSON push limit or invent cryptographic framing.

### Later explorations

- [ ] **R08 — Evaluate real-time collaborative editing.**
      Define the user need, E2EE-compatible client-side merge model and performance
      budgets before adopting a CRDT. Benchmark maintained open-source candidates;
      retain Markdown export and never move plaintext merging to the server.
- [ ] **R09 — Design a restricted plugin/extension system.**
      Define isolation, explicit permissions, compatibility and recovery from a broken
      extension. No unrestricted filesystem/network access or vault-key exposure by
      default. A marketplace is not part of this task.
- [ ] **R10 — Design an explicit lost-passphrase recovery option.**
      Review a user-controlled, opt-in recovery design and threat model before code.
      Use audited primitives and document exactly which previously established
      recovery material is required. No implicit server escrow or promise to recover
      a vault after all decryption/recovery material has been lost. This is separate
      from existing local history and server backup restoration.

## Delivery rules

- Load the relevant security, sync and delivery skills before starting an item.
- Begin with a failing behavioral test, implement the smallest slice, and run
  proportional validation with recorded output. Design-only items need a reviewed
  decision before their implementation stage, not speculative protocol code.
- Keep E2EE, durable outbox/ack rules, conflict variants, offline editing and
  minimal Tauri permissions intact. Update ADRs before changing a decision.
- All external calls, live deployment actions, commits and pushes require the
  applicable explicit authorization. Do not introduce mandatory SaaS or new
  dependencies without role/license justification.
- Change a checkbox only when its acceptance evidence exists. CI success alone
  does not finish clean-machine QA, live-provider validation or a new feature.
