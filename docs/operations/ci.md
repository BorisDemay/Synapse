# Contrôles qualité et CI auto-hébergeable

Synapse utilise **GitHub Actions** et une
commande locale unique `just verify`.

## Prérequis locaux

- Rust stable avec `rustfmt` et `clippy`
- `pnpm` 11.x et Node 22.17.x
- Outils Rust : `just`, `cargo-nextest`, `cargo-deny` (`cargo install … --locked`)
- PostgreSQL de test/dev : `just db` (ou `docker compose -f infra/docker/compose.test.yml up -d`)
- Navigateurs Playwright

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

## Commande unique

```bash
just verify
```

Enchaîne : `cargo fmt --check`, `clippy -D warnings`, `cargo nextest` (avec
`SYNAPSE_ALLOW_PUBLIC_SIGNUP` / `SYNAPSE_COOKIE_SECURE` /
`SYNAPSE_ALLOWED_ORIGIN` retirés pour respecter les defaults de test), Vitest,
`pnpm typecheck`, `pnpm lint`, smoke Playwright
(`tests/e2e/web-register-save.spec.ts`), `cargo deny check`, `pnpm audit --prod`.

Les tests d’intégration `synapse-server` sont sérialisés via
`.config/nextest.toml` (groupe `server-db`) parce qu’ils partagent une
PostgreSQL unique.

## Workflows GitHub

| Fichier                              | Rôle                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `.github/workflows/verify.yml`       | Gates de pull request, sans permission de publication                                |
| `.github/workflows/main-release.yml` | Pipeline `main` sérialisé : verify, version, builds, signatures, NAS, release stable |

Le job final reçoit seul `contents: write`. Protéger `main` avec le statut
`verify` requis. Les pushes directs déclenchent le même pipeline complet.

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
- L’audit npm ne couvre que les dépendances de production (`pnpm audit --prod`).
