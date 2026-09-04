# Checklist de préversion Synapse

Exécuter dans l’ordre sur une machine de référence (Linux ou Windows/WSL2).
Ne cocher une case qu’après une sortie réelle de commande.

## Mise à jour continue

- [ ] `node --test tests/release/*.test.mjs` valide parité, SemVer, SHA et URLs immuables.
- [ ] Windows Authenticode et les signatures Tauri Windows/Linux sont vérifiées.
- [ ] `/health/version`, `web.json` et `latest.json` exposent la même version et le même SHA.
- [ ] Un onglet web déjà ouvert et les deux clients desktop affichent la mise à jour prête.
- [ ] Le drill NAS confirme backup migration, manifestes en dernier et rollback d’images.

Vérifié le 2026-08-11 sur WSL2 (i5-14600KF) pour la préversion MVP.

## Qualité locale

- [x] `just verify` — fmt, clippy, nextest, Vitest, typecheck, lint, deny, audit, smoke Playwright
- [x] `cargo bench -p synapse-core --bench markdown -- --quick`
- [x] `cargo bench -p synapse-local-store --bench search -- --quick`
- [x] `k6 run tests/load/sync.js` contre une API locale (voir `docs/architecture/performance-budgets.md`)

## Self-hosting

- [x] `bash tests/integration/self_hosted.sh`
- [x] `bash tests/integration/backup_restore.sh`
- [x] `docker compose config` (fichier racine)

## Parcours vertical

- [x] API test + Postgres (`infra/docker/compose.test.yml`) et `SYNAPSE_ALLOW_PUBLIC_SIGNUP=true`
- [x] `pnpm playwright test tests/e2e/full-sync.spec.ts`
- [x] `pnpm playwright test tests/e2e/desktop.spec.ts`
- [x] `xvfb-run -a corepack pnpm --filter @synapse/desktop test:e2e:native` — fenêtre Tauri native et parcours de connexion WebDriver (WSL2)
- [ ] Optionnel : `SYNAPSE_RUN_BACKUP_E2E=1 pnpm playwright test tests/e2e/full-sync.spec.ts` (backup déjà couvert par `tests/integration/backup_restore.sh`)

## Limites connues à relire dans le README

- [x] Le smoke WebDriver natif vérifie la fenêtre et la connexion sans transmettre d’identifiant, mot de passe ou phrase de déchiffrement ; le conflit chiffré reste couvert par le scénario navigateur multi-client.
- [x] Le serveur ne voit aucun clair de coffre ; la phrase de déchiffrement ne quitte pas le client.
- [x] Aucun SaaS obligatoire ; SBOM via `just sbom` (artefacts sous `target/sbom/` seulement).
