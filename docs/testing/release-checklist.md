# Synapse — pre-release readiness checklist

Updated: 2026-10-03. The product remains pre-release. This checklist tracks
release evidence; it is not a list of features already built or a promise that
future features are required for the MVP. Open product work is in the
[current roadmap and todo](../plans/roadmap.md).

## Current verified baseline

For commit `b7ba4735aabc20ecc8f4dfc346cc7c524d91ff22`,
[CI run 37159224532](https://github.com/BorisDemay/Synapse/actions/runs/37159224532)
completed successfully with all jobs green:

- `verify-code`: configured Rust/frontend checks, harness/security/operations
  checks, typechecks, lint and dependency audits.
- `verify-e2e`: built-web real-API/PostgreSQL recovery journeys.
- `verify-recovery` and `verify-selfhosted`: isolated backup/restore, deployment
  drill and self-hosting checks.
- `desktop-native (ubuntu-latest)` and `desktop-native (windows-latest)`:
  native Tauri recovery, not merely two browser contexts.
- `desktop-bundle` on both OS targets, `images` and `publish`.

[Release v0.1.157](https://github.com/BorisDemay/Synapse/releases/tag/v0.1.157)
was published for that SHA. A green run is evidence for its revision only. Do
not copy these results onto a later revision without checking its run.
Historical local/CI observations, counts and platform qualifications are retained
in [validation history](validation-history.md).

No end-user fresh-install/update or live-provider test is inferred from the
above jobs. No new product validation commands were run for this documentation
reset; the baseline was checked through GitHub's run/job/release metadata.

## Outstanding acceptance evidence

Record the tested version/SHA, OS/environment, command or scenario, actual result
and relevant limitations before checking an item. Use synthetic vault content;
never include credentials, keys, note content or production URLs in reports.

### R01 — clean-machine installation and updates

- [ ] Install the published Windows package on a clean Windows machine; confirm
      installer/signature trust and open/create/unlock a vault. Do not count a
      self-signed test certificate as a publicly trusted signature.
- [ ] Install the published Linux package on a clean supported Linux machine;
      confirm packaged editor assets and local/offline operation.
- [ ] On each OS, exercise a real signed update, restart and version/SHA parity,
      preserving local data and pending encrypted work.
- [ ] Exercise supported server/web rollback and desktop downgrade rejection;
      confirm compatible data and truthful update/error feedback.

See [release](../operations/release.md), [upgrades](../operations/upgrades.md)
and [rollback](../operations/rollback.md). The first updater-compatible desktop
binary still requires manual installation.

### R02 — target-deployment restoration

- [ ] Restore a representative encrypted PostgreSQL/blob backup into a disposable
      environment; verify integrity, version/migration compatibility and health.
- [ ] Reopen a restored vault with user-held unlock material and verify encrypted
      sync/recovery behavior. A server backup cannot replace a lost passphrase.
- [ ] Record and verify the operator recovery procedure. Any action involving a
      live deployment or production secrets requires explicit approval.

Existing backup/restore automation already exists and is exercised in CI. This
item is target-environment readiness, not a claim that restoration is missing.
See [backup/restore](../operations/backup-restore.md).

### R03 — remaining documentation reconciliation

- [ ] Review security/operator descriptions against shipped behavior, especially
      multi-provider AI, CSP and native/client boundaries. Resolve discrepancies
      through reviewed ADR changes where needed, not undocumented exceptions.
- [ ] Ensure install/update/backup instructions are reproducible and label
      historical counts/results by revision and platform.

The README, active roadmap and readiness/history split were refreshed during
this reset. This remaining item is the deeper cross-document review.

### R04 — optional live AI-provider validation

- [ ] With explicit external-call consent and user-supplied credentials, exercise
      supported providers/authentication modes using synthetic notes only.
- [ ] Verify streaming, tool mutations, refusals/malformed responses, cancellation
      and failures, including no success claim when no note was written.
- [ ] Record which providers were actually tested; keep live calls and credentials
      out of ordinary CI. Mocked tests do not prove provider availability.

## Limits that must remain explicit

- The server stores opaque ciphertext and never sees vault content or keys in
  plaintext. A forgotten passphrase is not currently recoverable without an
  already usable decryption method.
- Desktop Markdown replicas remain plaintext on disk after locking. Automatic
  import of unknown/externally modified files is not implemented (R05).
- Cross-account E2EE sharing is not implemented (R06). Instance administration
  and user invitations are not the same feature as shared vault access.
- Notes/attachments are capped at 10 MiB per encrypted item; larger attachments
  require a separately approved streamed protocol (R07).
- Local deletion recovery and sparse encrypted snapshots are not independent
  backups. A sudden close during the two-second idle-save window can lose the
  unsaved in-memory draft.
- An optional AI provider sees the content explicitly sent to it. Synapse's
  E2EE claim does not make that content private from the chosen provider.

Real-time collaboration, plugins and a new opt-in recovery design (R08–R10) are
future explorations, not unresolved failures of the current MVP.
