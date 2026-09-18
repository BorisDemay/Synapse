# Checklist de préversion Synapse

Exécuter dans l'ordre sur une machine de référence (Linux ou Windows/WSL2).
Ne cocher une case qu'après une sortie réelle de commande.

## Mise à jour continue

Les points ci-dessous ont été développés et validés localement le 2026-09-17
(Linux/WSL2). Les exécutions qui dépendent de Windows ou d'un NAS réel restent
signalées comme telles.

- [x] `node --test tests/release/*.test.mjs` — 57 tests : parité, SemVer, SHA,
      URLs immuables, vérification des signatures updater, workflow et
      déployeur.
- [x] Les signatures updater des artefacts construits sont vérifiées contre
      `TAURI_UPDATER_PUBLIC_KEY` dans le job `desktop` (Linux et Windows) et
      re-vérifiées dans le job `publish` avant l'assemblage de l'archive.
      `infra/scripts/release/verify-signature.mjs` et
      `tests/release/signing.test.mjs` couvrent le contrôle, et le test de
      workflow garantit son ordre après le bundling.
- [x] Exécution réelle du workflow `main-release` — run `35256069995`
      (SHA `5f0da27`) : tous les jobs verts, dont `desktop-bundle
      (windows-latest)`, qui importe le certificat Authenticode, sonde
      `signtool`, construit le paquet signé, vérifie la signature Tauri contre
      `TAURI_UPDATER_PUBLIC_KEY` puis publie la release GitHub `v0.1.32`.
      Le certificat de test étant auto-signé, la confiance Authenticode est
      explicitement ignorée ; la vérification stricte `signtool verify /pa`
      reste appliquée à un certificat non auto-signé.
- [x] L'instance NAS exécute une release publiée. Observé le 2026-09-17 :
      bootstrap de `0.1.33` (SHA `da048ad3…`) — `/health/version`,
      `/build.json`, `/updates/stable/latest.json` et `/updates/stable/web.json`
      exposent la même version et le même SHA, `.active-version` et
      `releases/stable/current` pointent sur `0.1.33`, les conteneurs tournent
      en `synapse-{server,web}:0.1.33`. Corrigés pour y parvenir : layout
      comparé sous un nom de projet unique, `backup.sh` appelé avec `ENV_FILE`,
      nginx custom servant les manifests via `current`, résolution locale de
      l'URL publique. Tailscale mis à jour (1.98.8 → 1.102.3) en `serve`
      tailnet-only, sans Funnel.
- [x] Updater authentifié : PAT fine-grained (`Contents: Read-only`) déposé dans
      `/srv/synapse/.update-token` (root, `0600`) ; `synapse-update.service`
      sort en `Result=success` / `ExecMainStatus=0` au lieu du 404 initial. Le
      timer récupère donc les prochaines releases `main` toutes les 15 min.
- [x] `/health/version`, `web.json` et `latest.json` exposent la même version et
      le même SHA : le déployeur relit les deux manifests stables après
      activation et exige l'identité attendue, sinon il déclenche le rollback.
      Observé par 31 tests `deploy-release` et par `release_drill.sh`.
- [x] `just e2e-recovery` — le scénario `update-ready.spec.ts` ouvre une page
      construite, sert un `web.json` plus récent, déclenche `focus` et observe
      la bannière « Mise à jour prête » dans Chromium réel. Les clients desktop
      partagent le coordinateur, la bannière et le déclencheur (tests
      unitaires) ; leur exécution native reste dans le job CI.
- [x] `bash tests/integration/release_drill.sh` — projet Compose jetable,
      images étiquetées et TLS local : sauvegarde sur changement de migration,
      manifestes en dernier et rollback d'images et de pointeur observés
      (exécution locale Linux, ~1 min). Inclus dans `just verify` via
      `test-release-drill`.

Les coches ci-dessous concernent la revue de fiabilité du 2026-09-08 sur
Linux/WSL2 (i5-14600KF). Les anciennes observations du 2026-08-11 ne valident
pas les modifications de cette revue. Les résultats Windows doivent provenir
du job Windows ; une exécution sous WSL2 constitue une observation Linux.

## Qualité locale

- [x] `just verify` - suite intégrée sur l'état final de la revue, sortie réelle
      `just verify: all gates passed`, code de sortie 0.
- [x] Format Rust et clippy workspace ; 174 tests Rust de référence avec PostgreSQL réelle.
- [x] 27 tests Rust natifs, dont 13 tests de réplique dossier et 7 tests de
      session/transport ; format et clippy natifs passent également.
- [x] 11 tests Python des opérations de sauvegarde/restauration.
- [x] 392 tests JavaScript, 7 tests du harness et 9 tests de publication ;
      typechecks, formatage, clippy et audits passent, y compris l'audit npm du
      graphe complet.
- [x] Régression de sécurité locale bornée : 31 contrôles HTTP, navigateur et
      WebSocket, zéro finding.
- [x] Benchmark du client canonique avec 10 000 notes chiffrées et réplique native
      (voir `docs/architecture/performance-budgets.md`). Les anciens benchmarks
      SQLite/FTS5 ne mesurent pas le parcours Vue/IndexedDB actuel.

## Self-hosting

- [x] `bash tests/integration/self_hosted.sh` - projet jetable sur 18090,
      compte et session persistants après redémarrage, nettoyage observé.
- [x] `bash tests/integration/backup_restore.sh`
- [x] `docker compose --env-file .env.example -f docker-compose.yml config --quiet`

Le scénario de restauration a réellement détruit les volumes de son projet
jetable, restauré PostgreSQL et les blobs, puis comparé le ciphertext et le
nonce. Les archives incomplètes, altérées ou invalides ont été refusées avant
la restauration destructive. Aucun projet de développement existant n'est
utilisé pour ce scénario.

## Parcours vertical

- [x] `just e2e-recovery` — neuf scénarios de l’application construite, inscription/activation,
      sauvegarde automatique, ouverture hors ligne, reprise, conflits, historique et
      détection d’une mise à jour web dans un onglet déjà ouvert.
- [x] `dbus-run-session -- xvfb-run -a corepack pnpm --filter @synapse/desktop test:e2e:native` -
      véritable fenêtre Tauri Linux, profil et dossier temporaires, édition et reprise
      après redémarrage du processus ; deux exécutions Linux réussies, dont celle
      du reviewer indépendant. Reconnexion et résolution de conflit suivies jusqu'à
      acquittement, puis vérification des octets répliqués.
- [x] Jobs CI natifs Windows/Linux et gate avant build de publication revus.
- [x] Job CI natif Windows - mêmes garanties dans le WebView Windows.
      Observation Windows, distincte des validations Linux/WSL2 : workflow `verify`
      34654442136 (`ci/windows-native`, SHA `8cd941c565ce584fe4eeddaed6a5ec2686fe6d72`)
      réussi ; job `desktop-native (windows-latest)` 103443659815 réussi, dont
      `Native Tauri recovery`.
- [x] `tests/e2e/full-sync.spec.ts` tourne sans variable d’environnement dans
      `just e2e-recovery` ; la sauvegarde/restauration réelle est couverte par
      `tests/integration/backup_restore.sh`.

## Limites connues à relire dans le README

- [x] Deux contextes Playwright vérifient deux clients navigateur ; ils ne
      constituent pas une preuve de fonctionnement du pont Rust ou du WebView natif.
- [x] Le serveur ne voit aucun clair de coffre ; la phrase de déchiffrement ne quitte pas le client.
- [x] Aucun SaaS obligatoire ; SBOM via `just sbom` (artefacts sous `target/sbom/` seulement).
- [x] Les coffres desktop sans serveur ont un profil distinct. Leur réplique
      Markdown reste en clair sur disque après verrouillage ; les modifications
      externes ne sont pas importées automatiquement.

Les commits et validations de cette revue sont consignés dans la
[checklist de préversion](release-checklist.md).
