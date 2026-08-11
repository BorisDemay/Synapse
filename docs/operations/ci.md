# Contrôles qualité et CI auto-hébergeable

Synapse utilise **Forgejo Actions** (compatible syntaxe GitHub Actions) et une
commande locale unique `just verify`.

## Prérequis locaux

- Rust stable avec `rustfmt` et `clippy`
- `pnpm` 11.x et Node 22.17.x
- Outils Rust : `just`, `cargo-nextest`, `cargo-deny` (`cargo install … --locked`)
- PostgreSQL de test : `docker compose -f infra/docker/compose.test.yml up -d`
- Pour le smoke Playwright : API sur `127.0.0.1:3000` et navigateurs Playwright

Exemple de démarrage API de test :

```bash
export SYNAPSE_BIND_ADDR=127.0.0.1:3000
export SYNAPSE_DATABASE_URL=postgres://postgres@127.0.0.1:55432/synapse_test
export SYNAPSE_STORAGE_PATH=/tmp/synapse-blobs
export SYNAPSE_ALLOWED_ORIGIN=http://127.0.0.1:5173
export SYNAPSE_ALLOW_PUBLIC_SIGNUP=true
export SYNAPSE_COOKIE_SECURE=false
cargo run -p synapse-server
```

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

## Workflows Forgejo

| Fichier | Rôle |
| --- | --- |
| `.forgejo/workflows/ci.yml` | Gates sur push/PR, PostgreSQL service, artefacts d’échec |
| `.forgejo/workflows/release.yml` | Build release + SBOM CycloneDX en artefacts (pas dans Git) |

Les permissions Actions sont limitées à `contents: read`. Le cache n’est pas
obligatoire ; Node utilise le cache pnpm optionnel de l’action officielle.

## SBOM CycloneDX

```bash
just sbom
```

Écrit `target/sbom/rust.cdx.json` et `target/sbom/node.cdx.json`. Ces fichiers
sont des artefacts de release uniquement (répertoire `target/` ignoré par Git).

## Politique

- Aucun secret de production dans les workflows.
- Les contrôles de licence/advisories Rust passent par `deny.toml`.
- L’audit npm ne couvre que les dépendances de production (`pnpm audit --prod`).
