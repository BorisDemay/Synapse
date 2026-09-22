# Writing-first UX implementation — 22 September 2026

## Scope

Implement the current-interface review, not the historical UI roadmap. Keep the
shared encrypted web/desktop client and existing protocols. The primary loop is:
open → resume or create → write → see durable-save state → find again → recover.

## Delivery tracks

| Track            | Owned surface                                       | Acceptance                                                                                                                        |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Editor           | MarkdownEditor and editor tools                     | Search never mutates content; distinct link shortcut; focus API; compact formatting with all actions reachable                    |
| Dialogs          | Settings, search, relations and conflict components | Initial focus, trapped Tab, Escape and focus return; accurate labels and visible scoped feedback                                  |
| Account          | Web/desktop login, registration and activation      | Explicit activation next step, busy guards, helpful safe errors, prominent native local mode                                      |
| Unlock           | Shared vault creation/unlock                        | Creation confirmation, truthful loss warning, local trusted-device consent, safe discovery retry and native cancellation          |
| Workspace        | VaultView, explorer and tree                        | Full paths, working templates, visible search/new note, recents/resume, editor focus, accurate save state, independent note tools |
| Recovery         | Vault store and encrypted retained revisions        | Deleted items discoverable after restart; restoration uses normal encrypted mutations and preserves path and bytes                |
| Responsive shell | AppShell, layout and tokens                         | Drawer navigation on small screens; reachable side tools; no offscreen panels at 390–1440 px                                      |

The parent owns cross-track integration, deleted-items UI, dirty-draft flushing
before deletion, end-to-end validation, and publication. Concurrent candidates
use separate worktrees. Candidate changes are not separately delivered releases.

## Security and behavior decisions

- Account password and vault passphrase remain separate. Confirmation is a UI
  safeguard, not a new cryptographic policy. Synapse cannot recover a forgotten
  vault passphrase; trusted devices are convenience, not escrow.
- Account-session memory does not imply vault unlock. A local native vault is
  not silently uploaded when an account is connected; export/import stays explicit.
- Recovery uses existing encrypted local history and the existing deletion
  sentinel. See ADR 0017. No plaintext trash database or new server API.
- Recent-note preferences stay in the existing encrypted per-vault preferences.
- "Saved on this device" requires successful durable local persistence. Network
  pending, offline, synchronized and conflict/error states remain distinct. Local
  mode must not claim remote synchronization.
- Only explicitly attached notes go to an optional AI provider. Backlinks and
  history must not require opening AI or connecting a provider.
- The editor remains usable offline; network work never gates local editing.
- New dependencies, new crypto and server-side plaintext processing are out of scope.

## Validation

1. Each implementation track records failing behavioral tests before its fix,
   then focused tests and affected package suites/typechecks.
2. `node --test tests/ux/writing-first.mjs` exercises actual local Chromium,
   Vditor, encrypted IndexedDB and keyboard/responsive behavior with synthetic
   data and blocked external/API requests. This does not prove server sync.
3. Existing Playwright recovery journeys use the isolated real API/PostgreSQL
   harness for registration, durable offline edits, replay and conflicts.
4. Web/desktop frontend tests, types, formatting and builds must pass on the
   integrated tree. Native OS validation is reported separately, not inferred
   from browser checks.
5. Final review must verify no regression to unsaved-draft guards, lock/logout
   purging, attachment consent, import/path validation or operation durability.

## Initial evidence

The unchanged baseline reproduced all five selected browser regressions:
search mutating the document in both editing modes, lost folder context in
search, missing editor focus after New note, and failure to resume a recent note.
The baseline UI suite also contained an existing Settings session-category test
failure; fixing that actual settings behavior is included in the dialog track.

## Integrated validation — 22 September 2026

- `pnpm test`: 656 tests passed (API client 2, UI 234, web 307, desktop 113),
  after integrating the concurrent upstream registration and assistant-stream fixes.
- `pnpm typecheck` and `pnpm lint`: passed.
- `pnpm test:ux`: 14 real-browser checks passed, including IR/source shortcuts,
  full-path search, focus containment, resume, latest-draft delete/reopen/restore,
  mobile drawer and secondary-tool overlays, and 390–1440 px geometry.
- `just e2e-recovery`: 10 isolated real-API/PostgreSQL journeys passed, including
  restored deletion synchronizing to a second client as a new revision.
- `dbus-run-session -- xvfb-run -a pnpm --filter @synapse/desktop test:e2e:native`:
  passed on Linux: native picker selection/cancellation, local creation/edit/restart,
  Markdown replica bytes, attachments, history, offline restart/reconnect and conflicts.
- `node tests/performance/client-benchmark.mjs`: 10,000-note reopen and delta
  checks passed; 80 rendered tree rows and 593 DOM elements. The fixed-control
  budget adjustment is recorded in `docs/architecture/performance-budgets.md`.

Fresh-context reviews covered interaction/layout, onboarding, workspace and
recovery. Integration added regressions for stale restoration, inaccessible
mobile drawer height, invisible stroke icons, programmatic focus escape,
offline discovery, local-vs-sync feedback and dirty-draft deletion. No new
runtime dependency, server protocol or cryptographic primitive was introduced.
Windows native runtime testing was not performed in this Linux environment.
