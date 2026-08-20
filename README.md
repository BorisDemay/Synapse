# Synapse — base d’un espace de notes Markdown synchronisé

> Un espace de connaissances local-first, chiffrable et auto-hébergeable, inspiré des usages d’Obsidian sans en reprendre le code ni l’identité.

## Vision

Synapse est un projet **from scratch** visant à offrir une expérience de prise de notes Markdown rapide, hors-ligne et fiable, disponible via :

- un **client lourd** Tauri qui embarque le même coffre chiffré que le web ;
- une **interface web** moderne pour accéder aux mêmes contenus depuis un navigateur ;
- un serveur optionnel, simple à auto-héberger, qui assure la synchronisation temps réel et le partage contrôlé.

Les fichiers Markdown restent l’unité de vérité : ils doivent demeurer lisibles, exportables et utilisables sans enfermement propriétaire. La synchronisation ne doit jamais empêcher le travail local.

## Objectifs prioritaires

1. **Performance** — ouverture instantanée des coffres, recherche fluide, faible empreinte mémoire et synchronisation incrémentale.
2. **Sécurité** — conception défensive, isolation des données, authentification robuste, journalisation maîtrisée et chiffrement en transit.
3. **Local-first** — l’application reste utilisable sans connexion ; les modifications sont synchronisées dès que possible.
4. **Interopérabilité** — Markdown standard, pièces jointes sur disque, export simple et API documentée.
5. **Auto-hébergement** — déploiement reproductible avec une configuration minimale, Docker/Compose et sauvegardes explicites.
6. **Fiabilité** — aucune perte silencieuse : versionnage, détection de conflits, reprise après interruption et observabilité.

## Fonctionnalités prévues

### Gestion du coffre

- Cache local chiffré, utilisable hors connexion, pour chaque coffre autorisé.
- Création, renommage, déplacement et suppression de notes/dossiers.
- Surveillance du système de fichiers et prise en compte des modifications externes.
- Métadonnées YAML front matter, tags, liens `[[wikilinks]]`, backlinks et graphe de relations.
- Prévisualisation Markdown, édition riche ou texte brut, raccourcis clavier et thème clair/sombre.
- Historique local des modifications et restauration de versions.
- Recherche plein texte, filtre par tag/dossier/propriété et indexation incrémentale.

### Synchronisation et collaboration

- Synchronisation bidirectionnelle de notes Markdown et de pièces jointes.
- Transport temps réel lorsque la connexion est disponible ; rattrapage incrémental à la reconnexion.
- Synchronisation par opérations ou par blocs afin d’éviter le transfert complet d’un coffre.
- Détection de modifications concurrentes et résolution de conflit non destructive.
- Indicateur d’état par coffre/note : local, en attente, synchronisé, conflit, erreur.
- Partage futur par coffre, dossier ou note avec rôles explicites (lecture, écriture, administration).

### Interface web

- Connexion sécurisée et gestion des sessions.
- Navigation dans les coffres autorisés, édition Markdown et prévisualisation.
- Recherche, backlinks, tags et accès à l’historique selon les permissions.
- Compatibilité navigateur moderne, interface responsive et cache offline progressif.

## Principes d’architecture

```text
┌──────────────────────┐        HTTPS / WebSocket         ┌──────────────────────┐
│ Client lourd         │ ────────────────────────────────▶ │ Serveur de sync      │
│ - coffre local       │ ◀──────────────────────────────── │ - API/auth           │
│ - index local        │                                    │ - moteur de conflits  │
│ - file d’opérations  │                                    │ - stockage métadonnées│
└──────────────────────┘                                    └──────────┬───────────┘
         ▲                                                               │
         │                                                               ▼
         │ local                                               ┌──────────────────┐
┌────────┴─────────────┐                                      │ Stockage blobs   │
│ Interface web         │ ◀──────────────────────────────────▶ │ / fichiers       │
│ - cache navigateur    │          HTTPS / WebSocket            └──────────────────┘
│ - éditeur Markdown    │
└──────────────────────┘
```

### Modèle local-first

Chaque client possède :

- une copie locale du coffre ;
- une base d’index locale pour la recherche et les métadonnées ;
- une file persistante des opérations non envoyées ;
- des marqueurs de version permettant de demander uniquement les changements manquants.

Le serveur coordonne les changements et conserve les versions nécessaires à la réplication. Il ne doit pas être un point de blocage pour l’édition locale.

### Stratégie de conflits

Le projet doit privilégier des conflits explicites plutôt que des écrasements silencieux :

- fusion automatique uniquement lorsque les modifications sont manifestement disjointes ;
- conservation des deux variantes lorsqu’une fusion sûre n’est pas possible ;
- interface de comparaison et choix utilisateur ;
- journal d’audit des résolutions et possibilité de revenir à une version antérieure.

Pour l’édition collaborative simultanée à l’intérieur d’une même note, un CRDT peut être adopté dans une phase ultérieure. Le format final doit toutefois rester sérialisable proprement en Markdown.

## Sécurité

La sécurité est une exigence de conception, pas une étape de finition.

### Mesures minimales

- TLS obligatoire en production ; redirection HTTP vers HTTPS.
- Authentification avec mots de passe hachés par un algorithme moderne et résistant (Argon2id).
- Sessions courtes, cookies `HttpOnly`, `Secure`, `SameSite`, rotation et révocation des jetons.
- Autorisation systématique côté serveur sur chaque coffre, fichier et opération.
- Protection contre les attaques usuelles : CSRF, XSS, injection, traversal de chemin, SSRF, brute force et rejeu de requêtes.
- Validation stricte des schémas d’API, limites de taille, quotas et limitation de débit.
- Journalisation structurée sans contenu de notes, mots de passe, jetons ou données sensibles.
- Dépendances verrouillées, analyse de vulnérabilités, mises à jour régulières et SBOM générable.
- Sauvegardes chiffrées, testées et restaurables.

### Chiffrement de bout en bout obligatoire pour la synchronisation

Dans le MVP, tout contenu synchronisé est chiffré côté client avant l’envoi et
le serveur ne conserve que des données chiffrées. Les coffres locaux restent
utilisables sans serveur. Une phrase de déchiffrement distincte du mot de passe
d’authentification enveloppe la clé de coffre localement et ne traverse jamais
l’API. Cette conception limite volontairement la récupération de clés, le
partage et la recherche côté serveur ; ces limites sont documentées.

## Performance et optimisation

- Indexation incrémentale : seules les notes modifiées sont re-parsées.
- Recherche locale avec index persistant ; pagination et annulation des requêtes coûteuses.
- Chargement paresseux de l’arborescence, des aperçus et des pièces jointes.
- Synchronisation delta, compression des transferts et déduplication des blobs par empreinte de contenu.
- Traitement des gros fichiers en flux, avec plafonds configurables.
- Éviter les lectures/écritures synchrones sur le chemin critique de l’interface.
- Benchmarks reproductibles sur ouverture de coffre, indexation, recherche et synchronisation.
- Profiling et métriques avant toute optimisation structurelle.

## Architecture et décisions du MVP

Les frontières de responsabilité du monorepo sont consignées dans les ADR :

- [ADR 0001 — Monorepo et frontières de confiance](docs/adr/0001-monorepo-and-boundaries.md)
- [ADR 0002 — Synchronisation par opérations et révisions](docs/adr/0002-sync-versioning.md)
- [ADR 0011 — Le client web chiffré est canonique](docs/adr/0011-web-client-canonical.md)
- [ADR 0007 — Éditeur Markdown à rendu instantané](docs/adr/0007-vditor-instant-rendering-editor.md)
- [ADR 0008 — Assistant Codex optionnel côté client](docs/adr/0008-client-side-codex-assistant.md)
- [ADR 0010 — Item de coffre chiffré](docs/adr/0010-encrypted-vault-item.md)

Le [modèle de menace du MVP](docs/security/threat-model.md) précise les actifs,
frontières de confiance, menaces et contrôles. Le serveur est un coordinateur
opaque : il n'accède jamais au contenu des coffres en clair.

## Organisation cible du dépôt

```text
.
├── apps/
│   ├── desktop/          # Client lourd
│   ├── web/              # Application web
│   └── server/           # API, synchronisation et workers
├── packages/
│   ├── core/             # Modèle de coffre, Markdown, liens, conflits
│   ├── protocol/         # Contrats API et protocole de synchronisation
│   ├── ui/               # Composants partagés
│   └── config/           # Configuration, validation et observabilité
├── infra/
│   ├── docker/           # Images et Compose
│   ├── reverse-proxy/    # Exemples Caddy/Nginx
│   └── scripts/          # Sauvegarde, restauration, maintenance
├── docs/                 # Architecture, sécurité, exploitation
└── tests/                # Tests d’intégration, charge et end-to-end
```

## État MVP vérifié

Les commandes ci-dessous ont été exécutées avec succès sur le dépôt actuel.
Ne documenter ici que ce qui a réellement passé.

### Développement local

```bash
just dev
```

Démarre PostgreSQL (`synapse_dev`), l’API Rust (`http://127.0.0.1:3000`) et
l’UI Vite (`http://localhost:5173`) dans un seul terminal. `Ctrl+C` arrête les
deux. En deux terminaux : `just serve` puis `just web`.

```bash
just desktop
```

Démarre PostgreSQL (`synapse_dev`), l’API Rust (`http://127.0.0.1:3000`) et
la fenêtre native Tauri (Vite `http://127.0.0.1:1420`) dans un seul terminal.
`Ctrl+C` arrête les deux. L’édition utilise le cache chiffré local et ne bloque
pas l’interface pendant une indisponibilité réseau.

### Qualité

```bash
just verify
```

Enchaîne format Rust, clippy (`-D warnings`), `cargo nextest`, Vitest,
typecheck, Prettier, `cargo deny check`, `pnpm audit --prod` et le smoke
Playwright `tests/e2e/web-register-save.spec.ts`. Détails : `docs/operations/ci.md`.

Le client desktop (éditeur local, sync optionnelle) est aussi couvert par :

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @synapse/desktop test
pnpm --filter @synapse/desktop typecheck
```

### Self-hosting Docker Compose

```bash
cp .env.example .env
# Ajuster SYNAPSE_ALLOWED_ORIGIN et les secrets PostgreSQL
bash tests/integration/self_hosted.sh
bash tests/integration/backup_restore.sh
```

Stack minimale : PostgreSQL + API Rust + UI web + Caddy + volume de blobs.
Guide opérateur : `docs/operations/install.md`, sauvegarde :
`docs/operations/backup-restore.md`.

### Parcours chiffré web / sync

Prérequis : `just serve` (PostgreSQL `synapse_dev` persistante, distincte de
`synapse_test` que les tests Cargo vident) et
`SYNAPSE_ALLOW_PUBLIC_SIGNUP=true` / `SYNAPSE_COOKIE_SECURE=false`.

```bash
pnpm playwright test tests/e2e/full-sync.spec.ts
pnpm playwright test tests/e2e/desktop.spec.ts
```

Checklist de préversion : `docs/testing/release-checklist.md`.

### Performance

```bash
cargo run -p synapse-fixture-generator --release -- target/perf-vault 10000
cargo bench -p synapse-core --bench markdown -- --quick
cargo bench -p synapse-local-store --bench search -- --quick
SYNAPSE_BASE_URL=http://127.0.0.1:3000 k6 run tests/load/sync.js
```

Budgets mesurés : `docs/architecture/performance-budgets.md`.

### Limites connues du MVP

- Le client Tauri embarque le client web chiffré via un pont Rust fermé. Il ne
  reçoit aucun accès filesystem ou HTTP générique ; la session native reste en
  mémoire. Les anciens coffres de dossier sont conservés sans suppression
  implicite pendant leur migration explicite.
- Aucun contenu de coffre en clair n’atteint le serveur ; la phrase de
  déchiffrement reste locale.
- Pas de SaaS obligatoire, pas de télémétrie distante. Un chat Codex
  optionnel peut partir du client déverrouillé avec une clé fournie par
  l’utilisateur ; les notes liées vont alors vers OpenAI, jamais vers le
  serveur Synapse (ADR 0008). La CI ne valide pas d’appel live à Codex.
- SBOM CycloneDX : `just sbom` écrit sous `target/sbom/` (non versionné).

## Feuille de route

### Phase 1 — fondations locales

- Modèle de coffre, lecture/écriture Markdown et surveillance de fichiers.
- Éditeur, aperçu, arborescence, backlinks et recherche locale.
- Historique minimal et tests de non-régression.

### Phase 2 — service de synchronisation

- Comptes, coffres, autorisations et API versionnée.
- Réplication incrémentale, file d’opérations et gestion des conflits.
- Déploiement Docker, sauvegardes et observabilité de base.

### Phase 3 — web et robustesse

- Client web avec synchronisation et cache local.
- Partage, rôles, audit et limites d’usage.
- Tests de charge, durcissement sécurité et documentation d’exploitation.

### Phase 4 — collaboration avancée

- Édition temps réel d’une note, présence et commentaires optionnels.
- Chiffrement de bout en bout optionnel.
- Extensions/API publique, import/export et écosystème de plugins isolés.

## Non-objectifs initiaux

- Compatibilité binaire ou protocolaire avec Obsidian Sync.
- Marketplace de plugins avant la stabilisation du modèle de sécurité.
- Intelligence artificielle obligatoire, ou relais des notes en clair via le
  serveur Synapse. Un chat Codex optionnel peut partir du client déverrouillé
  avec la clé de l’utilisateur (ADR 0008).
- Dépendance obligatoire à un service cloud propriétaire.

## Stack retenue — Vue.js, Rust et logiciels libres

Le projet retient une stack **open source, auto-hébergeable et sans dépendance à un service payant**. Chaque composant de production doit pouvoir être exécuté sur l’infrastructure de l’utilisateur. Les éventuels services managés ne sont ni nécessaires, ni une dépendance du produit.

| Couche | Technologies retenues | Licence / rôle |
|---|---|---|
| Client lourd | **Tauri 2**, **Rust**, **Vue 3**, TypeScript, Vite | Tauri (MIT/Apache-2.0), Vue (MIT) ; application native légère et sécurisée |
| Interface web | **Vue 3**, TypeScript, Vite, Vue Router, Pinia | MIT ; SPA statique servie par le serveur ou un proxy inverse |
| Design système | Tailwind CSS ou UnoCSS, composants Vue internes | MIT ; aucun kit UI propriétaire requis |
| Éditeur Markdown | Vditor 3 en mode IR + prévisualisation markdown-it | MIT ; rendu instantané CommonMark/GFM, ressources embarquées localement |
| Serveur | **Rust**, Axum, Tokio, Tower | MIT ; API HTTP et synchronisation temps réel à faible empreinte |
| Contrats API | OpenAPI, JSON Schema, génération de clients TypeScript | Standards ouverts ; protocole versionné et documenté |
| Temps réel | WebSocket sécurisé, opérations idempotentes, synchronisation delta | Standard ouvert ; protocole applicatif documenté |
| Collaboration avancée | Automerge ou yrs/Yjs, uniquement si les benchmarks le justifient | MIT ; CRDT auto-hébergeable, sans service tiers |
| Métadonnées | **PostgreSQL** | PostgreSQL License ; comptes, droits, index et historique de synchronisation |
| Index local | **SQLite** + FTS5 ; Tantivy si une indexation Rust plus poussée est nécessaire | Domaine public / MIT ; recherche locale hors ligne |
| Stockage de fichiers | Système de fichiers local par défaut ; **MinIO** pour le stockage objet S3-compatible distribué | AGPLv3 ; entièrement auto-hébergeable |
| Proxy et TLS | **Caddy** | Apache-2.0 ; certificats TLS automatisés et reverse proxy |
| Conteneurs | Docker Engine + Docker Compose | Déploiement reproductible ; possibilité Podman/Compose compatible |
| Observabilité | OpenTelemetry, Prometheus, Grafana, Loki | Apache-2.0/AGPLv3 ; métriques, traces et logs locaux |
| CI locale | Forgejo Actions ou Woodpecker CI | GPLv3/Apache-2.0 ; aucune plateforme SaaS obligatoire |

### Décisions d’architecture

- **Vue.js plutôt que React** : Vue 3 est le framework d’interface commun au client lourd et au web. L’équipe bénéficie d’un modèle de composants cohérent, d’une bonne ergonomie TypeScript et d’un bundle maîtrisable.
- **Rust pour le cœur sensible** : le serveur de synchronisation, le moteur de coffre partagé et les chemins critiques du client Tauri sont écrits en Rust. Cela réduit l’empreinte mémoire et apporte des garanties de sûreté mémoire sans garbage collector.
- **Tauri plutôt qu’Electron** : le client lourd s’appuie sur le WebView natif et un binaire Rust, afin de limiter la taille de distribution, la consommation de mémoire et la surface d’attaque.
- **PostgreSQL + système de fichiers par défaut** : un seul serveur suffit pour une installation personnelle. MinIO est uniquement proposé lorsque plusieurs nœuds ou un stockage objet sont nécessaires.
- **Pas de dépendance cloud** : pas de Firebase, Supabase Cloud, Auth0, Sentry SaaS, Algolia Cloud, Vercel, GitHub obligatoire, ni autre API commerciale dans le chemin de production.
- **Protocoles ouverts** : API HTTP documentée par OpenAPI, WebSocket documenté et formats Markdown/JSON standards. Les données restent exportables sans outil propriétaire.

### Contraintes de licence et d’exploitation

- Les dépendances doivent être open source et compatibles avec la licence finale du projet ; leur licence doit être vérifiée dans la CI.
- Les composants sous AGPLv3, tels que MinIO ou Grafana, sont utilisés comme services autonomes et ne doivent pas être intégrés ou redistribués sans évaluer les obligations correspondantes.
- Un déploiement minimal ne requiert que le serveur Rust, PostgreSQL, le volume de fichiers local et Caddy. Les métriques, MinIO et Forgejo sont optionnels.
- Les intégrations externes restent facultatives, désactivées par défaut et remplaçables par une implémentation auto-hébergée.

### Justification

Cette stack privilégie les standards ouverts, la sobriété des ressources et l’autonomie opérationnelle. Elle permet de livrer rapidement une interface Vue.js moderne tout en réservant Rust aux composants où la performance, la concurrence et la sécurité sont déterminantes. L’ensemble peut être distribué sous forme de binaires et de conteneurs, sans abonnement ni compte chez un fournisseur tiers.
