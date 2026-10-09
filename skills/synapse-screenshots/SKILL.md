---
name: synapse-screenshots
description: Capture deterministic screenshots of Synapse web UI pages, panels, and menus with synthetic local fixtures. Use when asked to take, redo, compare, or refresh UI screenshots.
version: 0.1.0
author: Project maintainer, Hermes Agent
license: AGPL-3.0-or-later
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [synapse, screenshots, playwright, vue, ui-review]
    related_skills: [synapse-delivery]
---

# Synapse Screenshots

Use this skill when capturing or refreshing screenshots of the Synapse web UI.
It is a UI delivery task: follow `skills/synapse-delivery/SKILL.md` for Vue and
validation rules.

## Invariants

- Use only synthetic fixture data. Never unlock or capture a real user vault.
- The script mocks account/API routes and creates a disposable local encrypted
  vault in the browser profile.
- Screenshots are local artifacts under `screenshots/`, which is gitignored.
- Do not commit generated PNGs unless a maintainer explicitly requests it.

## Commands

Capture the full UI catalog:

```bash
pnpm screenshots:ui
```

Capture selected states only:

```bash
pnpm screenshots:ui -- --only=05-page-activate-success,23-panel-import-preview,26-panel-conflict-resolver
```

Use a custom output directory:

```bash
pnpm screenshots:ui -- --out=screenshots/manual-check
```

The command prints each generated PNG and the final output directory.

## Current screenshot states

- Authentication and onboarding: login, register, register success, activation,
  activation success, vault creation.
- Administration: users/invitation page and role dropdown.
- Vault workspace: main editor, search palette, settings categories, deleted
  items, assistant connection/chat/conversations, note history, quick assistant,
  note context menu, import preview, editor context menu/submenu, conflict
  resolver.

## When updating UI

1. Add or update targeted component/unit tests first for layout or state changes.
2. Run the affected tests and typecheck.
3. Run `pnpm screenshots:ui` or a narrow `--only=...` capture.
4. Inspect the generated PNGs before reporting completion.
