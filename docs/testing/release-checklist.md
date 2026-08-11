# Checklist de préversion Synapse

Exécuter dans l’ordre sur une machine de référence (Linux ou Windows/WSL2).
Ne cocher une case qu’après une sortie réelle de commande.

## Qualité locale

- [ ] `just verify` — fmt, clippy, nextest, Vitest, typecheck, lint, deny, audit, smoke Playwright
- [ ] `cargo bench -p synapse-core --bench markdown -- --quick`
- [ ] `cargo bench -p synapse-local-store --bench search -- --quick`
- [ ] `k6 run tests/load/sync.js` contre une API locale (voir `docs/architecture/performance-budgets.md`)

## Self-hosting

- [ ] `bash tests/integration/self_hosted.sh`
- [ ] `bash tests/integration/backup_restore.sh`
- [ ] `docker compose config` (fichier racine)

## Parcours vertical

- [ ] API test + Postgres (`infra/docker/compose.test.yml`) et `SYNAPSE_ALLOW_PUBLIC_SIGNUP=true`
- [ ] `pnpm playwright test tests/e2e/full-sync.spec.ts`
- [ ] `pnpm playwright test tests/e2e/desktop.spec.ts`
- [ ] Optionnel : `SYNAPSE_RUN_BACKUP_E2E=1 pnpm playwright test tests/e2e/full-sync.spec.ts`

## Limites connues à relire dans le README

- [ ] Pas de WebDriver Tauri pour le sync desktop complet : le stand-in navigateur couvre le conflit.
- [ ] Le serveur ne voit aucun clair de coffre ; la phrase de déchiffrement ne quitte pas le client.
- [ ] Aucun SaaS obligatoire ; SBOM via `just sbom` (artefacts sous `target/sbom/` seulement).
