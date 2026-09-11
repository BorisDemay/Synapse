# Contrôles qualité et CI auto-hébergeable

Synapse utilise **GitHub Actions** et une
commande locale unique `just verify`.

## Prérequis locaux

- Rust stable avec `rustfmt` et `clippy`
- `pnpm` 11.x et Node 22.17.x
- Outils Rust : `just`, `cargo-nextest`, `cargo-deny` (`cargo install … --locked`)
- PostgreSQL de test/dev : `just db` (ou `docker compose -f infra/docker/compose.test.yml up -d`)
- Navigateurs Playwright
- Python 3 et Docker Compose pour les scénarios de restauration
- Bibliothèques de développement GTK3/WebKitGTK 4.1 pour les contrôles Rust
  natifs Linux ; le parcours WebDriver exige aussi `tauri-driver`,
  `WebKitWebDriver`, Xvfb, `dbus-run-session`, `xdotool` et Openbox

`synapse_test` est réservé aux tests Cargo : ils y font `TRUNCATE` / `DROP SCHEMA`.
Les comptes utilisés à la main doivent aller dans `synapse_dev`, persisté par un volume
nommé. Relancer l’API ne doit plus recréer un compte.

Exemple de démarrage API locale persistante :

```bash
just serve
```

API et UI Vite ensemble : `just dev` (`http://127.0.0.1:3000` +
`http://localhost:5173`). Client lourd : `just desktop` (même API +
fenêtre Tauri, Vite `http://127.0.0.1:1420`).

Les tests Playwright sont autonomes. Leur configuration démarre une API sur
`127.0.0.1:13000` et l’application web construite sur `127.0.0.1:15173`, dans
une base jetable `synapse_e2e_<identifiant aléatoire>`. Les ports occupés font
échouer le démarrage ; aucun serveur de développement existant n’est réutilisé.
`SYNAPSE_E2E_API_PORT` et `SYNAPSE_E2E_UI_PORT` permettent de choisir deux autres
ports libres.

Les blobs et messages d’activation vivent dans un répertoire temporaire.
Le nettoyage arrête l’API, supprime sa base et retire ce répertoire, y compris
après un échec. Il ne supprime ni `synapse_dev` ni le volume PostgreSQL partagé.
Les tests d’ouverture hors ligne utilisent le service worker de l’application
construite ; Vite en mode développement ne constitue pas une preuve de cache
offline. Il n’est pas nécessaire de lancer `just serve` avant ces tests.

Le scénario de mise à jour utilise deux versions d’assets et deux onglets. Le
service worker attend l’activation explicite ; les assets des versions
précédentes restent disponibles aux onglets encore ouverts. Cette conservation
peut augmenter l’espace de cache des assets lors de mises à jour successives.
Elle concerne uniquement les fichiers publics de l’application, jamais les
réponses d’authentification ou les données de coffre.

## Commande unique

```bash
just verify
```

Enchaîne les contrôles Rust, y compris le crate Tauri autonome, et
`cargo nextest` (avec
`SYNAPSE_ALLOW_PUBLIC_SIGNUP` / `SYNAPSE_COOKIE_SECURE` /
`SYNAPSE_ALLOWED_ORIGIN` retirés pour respecter les defaults de test), Vitest,
`pnpm typecheck`, `pnpm lint`, les tests Node du harness et de publication,
les tests Python d’exploitation, `cargo deny check`, `pnpm audit` (graphe complet),
les parcours Playwright de récupération et les scénarios Compose de
redémarrage/restauration. La régression de sécurité bornée
`tests/security/local-penetration.mjs` lance aussi un serveur et une base
jetables, teste les limites d’authentification, les origines WebSocket, la
révocation et les autorisations, puis échoue au moindre constat. Le runner
natif s’exécute séparément dans les jobs
Windows/Linux ; un navigateur Playwright ne valide pas le pont Rust.

Les tests d’intégration `synapse-server` sont sérialisés via
`.config/nextest.toml` (groupe `server-db`) parce qu’ils partagent une
PostgreSQL unique.

## Parcours natif isolé

```bash
dbus-run-session -- xvfb-run -a corepack pnpm --filter @synapse/desktop test:e2e:native
```

Le runner construit un binaire de test avec un identifiant d’application
unique, un profil temporaire et une URL d’instance de test. Il ouvre le vrai
sélecteur OS, vérifie son annulation puis choisit un dossier temporaire. La
création, la connexion, l’édition, les redémarrages du processus et la résolution
de conflit passent par l’interface native. La création de pièce jointe et la
restauration d’historique appellent le store produit depuis WebDriver, puis
vérifient les octets réellement répliqués sur disque.

Le second parcours utilise une API et une base jetables, une modification
locale sans réseau, un redémarrage, une version distante chiffrée et une
résolution suivie jusqu’à l’acquittement. Les processus, profils et données de
test sont nettoyés. `VITE_SYNAPSE_INSTANCE_URL` fournit uniquement une valeur
initiale de configuration ; l’instance enregistrée par l’utilisateur reste
prioritaire et le pont Rust valide toujours l’URL.

Sous Windows, le job prépare une PostgreSQL temporaire sur loopback et un
WebDriver correspondant au runtime WebView2 installé. Il exécute le même
runner puis nettoie son cluster dans une étape `always()`. La configuration
Windows a été revue ; son exécution réelle doit être observée dans le job
Windows. Les résultats locaux de cette revue sont Linux/WSL2 et Chromium.

## Workflows GitHub

| Fichier                              | Rôle                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `.github/workflows/verify.yml`       | Gates de pull request, sans permission de publication                                |
| `.github/workflows/main-release.yml` | Pipeline `main` sérialisé : verify, version, builds, signatures, NAS, release stable |

Le job final reçoit seul `contents: write`. Protéger `main` avec le statut
`verify` requis. Les pushes directs déclenchent le même pipeline complet.

Les jobs de vérification, desktop Windows/Linux et images démarrent en
parallèle. La publication attend explicitement leur réussite à tous. `just
verify` conserve ses contrôles ; les tests Rust desktop et release ne sont
pas relancés une seconde fois après cette commande.

Les outils `just`, `cargo-nextest`, `cargo-deny` et `cargo-cyclonedx` sont
installés depuis des binaires précompilés avec vérification de checksum via
une action fixée à un commit. Les dépendances Rust des deux workspaces et
le driver Linux sont mis en cache, y compris après un échec ; seules les
exécutions `main` écrivent ces caches. Les images utilisent des caches de
couches BuildKit distincts et sont exportées directement en archives Docker.
Le contexte Docker exclut les dépendances locales, les compilations, les
worktrees et les secrets locaux.

Les paquets publiés sont l'AppImage Linux et l'installeur NSIS Windows ; les
formats DEB/RPM/MSI ne sont pas construits dans cette release. Les uploads
d'artefacts utilisent une compression nulle pour éviter de recompresser les
installeurs déjà compressés. Le contrôle de signature précède la compilation.

Le premier passage remplit les caches. Aucun délai maximal de release n'est
garanti : mesurer séparément une exécution froide et une exécution avec
caches avant d'annoncer un gain. Les caches n'incluent pas les clés privées
ni les fichiers PFX.

La version est `0.1.<github.run_number>`. Si le workflow est renommé ou son
compteur réinitialisé, augmenter la série au-dessus de toute version déjà
publiée avant de réactiver l’updater.

## SBOM CycloneDX

```bash
just sbom
```

Écrit `target/sbom/rust.cdx.json` et `target/sbom/node.cdx.json`. Ces fichiers
sont des artefacts de release uniquement (répertoire `target/` ignoré par Git).

## Politique

- Aucun secret de production dans les workflows.
- Les contrôles de licence/advisories Rust passent par `deny.toml`.
- L’audit couvre aussi le lockfile Tauri autonome. Les avis `unmaintained`
  GTK3/proc-macro/rust-unic sans upgrade sûr sont listés un par un dans
  `deny.toml` ; aucune vulnérabilité exploitable n’est masquée globalement.
- MPL-2.0 est autorisée pour les parseurs CSS transitifs Tauri, distribués comme
  dépendances distinctes compatibles avec l’AGPLv3.
- La licence permissive `0BSD` est autorisée uniquement comme dépendance
  transitive de `quoted_printable`, utilisée par le client SMTP `lettre`.
- L’audit npm couvre le graphe complet, y compris les outils de développement
  (`pnpm audit`).
