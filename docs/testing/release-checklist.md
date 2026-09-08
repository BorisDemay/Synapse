# Checklist de préversion Synapse

Exécuter dans l’ordre sur une machine de référence (Linux ou Windows/WSL2).
Ne cocher une case qu’après une sortie réelle de commande.

## Mise à jour continue

- [x] `node --test tests/release/*.test.mjs` valide parité, SemVer, SHA et URLs immuables.
- [ ] Windows Authenticode et les signatures Tauri Windows/Linux sont vérifiées.
- [ ] `/health/version`, `web.json` et `latest.json` exposent la même version et le même SHA.
- [ ] Un onglet web déjà ouvert et les deux clients desktop affichent la mise à jour prête.
- [ ] Le drill NAS confirme backup migration, manifestes en dernier et rollback d’images.

Les coches ci-dessous concernent la revue de fiabilité du 2026-09-08 sur
Linux/WSL2 (i5-14600KF). Les anciennes observations du 2026-08-11 ne valident
pas les modifications de cette revue. Les résultats Windows doivent provenir
du job Windows ; une exécution sous WSL2 constitue une observation Linux.

## Qualité locale

- [ ] `just verify` — suite intégrée sur l’état final de la revue.
- [x] Format Rust et clippy workspace ; 174 tests Rust de référence avec PostgreSQL réelle.
- [x] 24 tests Rust natifs, dont 13 tests de réplique dossier.
- [x] 11 tests Python des opérations de sauvegarde/restauration.
- [x] Benchmark du client canonique avec 10 000 notes chiffrées et réplique native
  (voir `docs/architecture/performance-budgets.md`). Les anciens benchmarks
  SQLite/FTS5 ne mesurent pas le parcours Vue/IndexedDB actuel.

## Self-hosting

- [ ] `bash tests/integration/self_hosted.sh`
- [x] `bash tests/integration/backup_restore.sh`
- [x] `docker compose --env-file .env.example -f docker-compose.yml config --quiet`

Le scénario de restauration a réellement détruit les volumes de son projet
jetable, restauré PostgreSQL et les blobs, puis comparé le ciphertext et le
nonce. Les archives incomplètes, altérées ou invalides ont été refusées avant
la restauration destructive. Aucun projet de développement existant n’est
utilisé pour ce scénario.

## Parcours vertical

- [ ] `pnpm playwright test` — application construite, inscription/activation,
  sauvegarde automatique, ouverture hors ligne, reprise, conflits et historique.
- [ ] `xvfb-run -a corepack pnpm --filter @synapse/desktop test:e2e:native` —
  véritable fenêtre Tauri Linux, profil et dossier temporaires, édition et reprise
  après redémarrage du processus.
- [ ] Job CI natif Windows — mêmes garanties dans le WebView Windows.
- [ ] Optionnel : `SYNAPSE_RUN_BACKUP_E2E=1 pnpm playwright test tests/e2e/full-sync.spec.ts` (backup déjà couvert par `tests/integration/backup_restore.sh`)

## Limites connues à relire dans le README

- [x] Deux contextes Playwright vérifient deux clients navigateur ; ils ne
  constituent pas une preuve de fonctionnement du pont Rust ou du WebView natif.
- [x] Le serveur ne voit aucun clair de coffre ; la phrase de déchiffrement ne quitte pas le client.
- [x] Aucun SaaS obligatoire ; SBOM via `just sbom` (artefacts sous `target/sbom/` seulement).
- [x] Les coffres desktop sans serveur ont un profil distinct. Leur réplique
  Markdown reste en clair sur disque après verrouillage ; les modifications
  externes ne sont pas importées automatiquement.

Les commits et approbations indépendantes sont consignés dans le
[complément au plan](../../.hermes/plans/2026-09-08-reliability-completion.md).
