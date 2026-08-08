# Synapse Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Construire un MVP local-first de Synapse permettant d’éditer, indexer et synchroniser de bout en bout des coffres Markdown chiffrés depuis une application Tauri/Vue et une interface web, avec un serveur Rust auto-hébergeable et sécurisé.

**Architecture:** Un monorepo combine un workspace Cargo pour le domaine, la cryptographie, le stockage, le protocole et le serveur, et un workspace pnpm pour Vue 3, les composants partagés et les clients générés. Le client lourd conserve les fichiers Markdown, un index local et une file d’opérations dans SQLite ; le web conserve un cache complet mais chiffré dans IndexedDB. Les clients chiffrent les contenus avant synchronisation ; Axum ne persiste que des blobs chiffrés, des enveloppes de clés et des métadonnées minimales nécessaires à l’autorisation et aux curseurs. La synchronisation est versionnée, incrémentale, idempotente et signale les conflits au lieu d’écraser silencieusement les données.

**Tech Stack:** Rust stable, Cargo, Axum, Tokio, Tower, SQLx, PostgreSQL, SQLite/FTS5, XChaCha20-Poly1305, Argon2id, Tauri 2, Vue 3, TypeScript, Vite, Pinia, Vue Router, CodeMirror 6, markdown-it, pnpm, Vitest, Playwright, cargo-nextest, Docker Compose, Caddy, OpenTelemetry et Prometheus.

---

## 1. Périmètre, hypothèses et critères de sortie

### MVP inclus

- Ouvrir un dossier local comme coffre depuis le client Tauri.
- Lister, créer, lire, modifier, renommer et supprimer des notes Markdown.
- Éditer une note avec CodeMirror et afficher son rendu Markdown assaini.
- Extraire le front matter, les tags, les wikilinks et les backlinks.
- Indexer et rechercher localement avec SQLite FTS5.
- Continuer à travailler hors ligne et conserver une file persistante d’opérations.
- Chiffrer côté client chaque contenu synchronisé ; le serveur ne reçoit ni Markdown ni index en clair.
- Conserver un cache hors ligne complet, chiffré au repos dans IndexedDB pour le web.
- Créer plusieurs comptes avec connexion classique email/mot de passe et sessions révocables.
- Créer des coffres privés isolés par utilisateur ; préparer les modèles ACL sans activer le partage de coffres chiffrés dans le MVP.
- Pousser et tirer les changements incrémentaux via HTTP, puis recevoir un signal temps réel via WebSocket.
- Détecter un conflit de versions, préserver les deux variantes chiffrées et permettre une résolution manuelle locale.
- Accéder au coffre synchronisé depuis le client web après déverrouillage local de la clé.
- Distribuer le client desktop pour Windows et Linux ; macOS est un objectif de bêta post-MVP.
- Installer le serveur avec Docker Compose, PostgreSQL, un volume de fichiers et Caddy.

### Hors MVP

- CRDT et édition simultanée caractère par caractère.
- Partage de coffres chiffrés entre utilisateurs : cela exige une distribution, rotation et révocation de clés de groupe auditable.
- Récupération d’un coffre chiffré sans phrase secrète ou dispositif déjà déverrouillé ; le produit doit rendre ce risque explicite.
- Graphe visuel, marketplace de plugins, mobile et intelligence artificielle.
- MinIO, Grafana/Loki et déploiement multi-nœuds ; les interfaces doivent seulement permettre leur ajout ultérieur.

### Décisions validées

- **Licence : AGPLv3.** Le code source des modifications déployées comme service réseau doit rester disponible ; cela protège le caractère open source du serveur auto-hébergé. Les dépendances doivent être compatibles avec cette licence.
- **Authentification : email + mot de passe.** Une instance neuve initialise un administrateur via variables d’environnement à usage unique ; l’administrateur crée les autres comptes par invitation. L’inscription publique est un réglage désactivé par défaut.
- **Chiffrement de bout en bout : obligatoire dans le MVP.** Une clé de coffre aléatoire chiffre les notes et pièces jointes avec XChaCha20-Poly1305. Cette clé est chiffrée (wrappée) localement par une clé dérivée du secret utilisateur via Argon2id. Le serveur stocke seulement ciphertexts, nonces, versions, empreintes de ciphertext et enveloppes de clés.
- **Multi-utilisateur : oui, avec coffres privés isolés dans le MVP.** Plusieurs comptes peuvent exister sur le même serveur ; le partage de contenu chiffré est volontairement différé afin de ne pas improviser la cryptographie de groupe.
- **Plateformes : Windows et Linux d’abord.** La CI vérifie Linux ; les builds et E2E de distribution ciblent Windows et Linux. macOS suit après une bêta validée.
- **Conflits : fusion trois voies locale seulement lorsqu’elle est sûre, sinon comparaison et résolution manuelle.** Le serveur détecte la révision obsolète mais, du fait du chiffrement, ne lit ni ne fusionne le contenu. Les CRDT sont reportés après le MVP : ils rendent l’édition simultanée fluide mais augmentent fortement la complexité, le coût de stockage et les contraintes de sérialisation Markdown.

### Hypothèses à valider avant le premier code produit

- Nom de travail : `Synapse` ; vérifier la disponibilité juridique avant publication.
- Licence du projet : AGPLv3 ; ajouter `LICENSE`, en-têtes de contribution et contrôle automatisé de compatibilité des dépendances.
- Node.js LTS, pnpm et Rust stable sont les outils de développement supportés.
- Windows et Linux sont les plateformes desktop MVP ; Linux est la première plateforme CI et macOS est validé après la bêta.
- Le serveur est la source de coordination, mais jamais une condition pour modifier les fichiers locaux.
- Une phrase secrète oubliée ne peut pas déchiffrer un coffre sans mécanisme de récupération explicite ; cette limite doit être affichée à la création du coffre.

### Critères globaux de sortie du MVP

- Un coffre de 10 000 notes s’ouvre sans lecture complète du contenu sur le thread UI.
- Une recherche locale retourne les premiers résultats en moins de 100 ms sur la machine de benchmark de référence.
- Une modification hors ligne est envoyée automatiquement après reconnexion.
- Deux modifications concurrentes ne provoquent aucun écrasement silencieux.
- `cargo nextest run --workspace`, `pnpm test`, `pnpm test:e2e`, `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm lint` passent.
- `docker compose up -d` démarre un service sain, et le scénario sauvegarde/restauration est testé.

## 2. Structure cible du dépôt

```text
.
├── Cargo.toml
├── Cargo.lock
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── rust-toolchain.toml
├── deny.toml
├── .editorconfig
├── .env.example
├── apps/
│   ├── desktop/
│   │   ├── package.json
│   │   ├── src/
│   │   ├── tests/
│   │   └── src-tauri/
│   ├── web/
│   │   ├── package.json
│   │   ├── src/
│   │   └── tests/
│   └── server/
│       ├── Cargo.toml
│       ├── src/
│       └── tests/
├── crates/
│   ├── synapse-core/
│   ├── synapse-protocol/
│   ├── synapse-local-store/
│   └── synapse-sync/
├── packages/
│   ├── api-client/
│   ├── ui/
│   └── config/
├── migrations/
├── infra/
│   ├── docker/
│   ├── caddy/
│   └── scripts/
├── tests/
│   ├── e2e/
│   ├── integration/
│   ├── load/
│   └── fixtures/
└── docs/
    ├── adr/
    ├── architecture/
    ├── operations/
    └── security/
```

## 3. Règles d’implémentation

1. Respecter strictement RED → vérification de l’échec → GREEN minimal → vérification → refactorisation.
2. Travailler par tranche verticale ; ne pas écrire tous les tests avant toute l’implémentation.
3. Un test doit échouer pour la fonctionnalité absente, pas à cause d’une erreur de compilation accidentelle.
4. Les tests de domaine utilisent le vrai code ; les mocks sont réservés aux frontières réseau, horloge et stockage.
5. Toute opération mutante possède un identifiant idempotent UUIDv7 et une version de base.
6. Aucun chemin fourni par un utilisateur ne peut être joint directement à la racine d’un coffre.
7. Aucun contenu de note, secret ou jeton ne doit apparaître dans les logs.
8. Ajouter un commit après chaque tâche verte ; utiliser des commits Conventional Commits.

---

## 4. Plan d’implémentation détaillé

### Task 1: Consigner les décisions structurantes

**Objective:** Figer le MVP, le modèle de cohérence, la stratégie de stockage et le modèle de menace avant le scaffolding.

**Files:**
- Create: `docs/adr/0001-monorepo-and-boundaries.md`
- Create: `docs/adr/0002-sync-versioning.md`
- Create: `docs/adr/0003-local-files-are-canonical.md`
- Create: `docs/security/threat-model.md`
- Modify: `README.md:124-269`

**Step 1: Écrire les ADR** avec statut, contexte, décision, conséquences et alternatives rejetées.

**Step 2: Définir les invariants de synchronisation** : opération idempotente, version croissante par coffre, contenu adressé par SHA-256, conflit si `base_version` est obsolète et fusion non sûre.

**Step 3: Définir les actifs et frontières de confiance** dans `docs/security/threat-model.md` : fichiers locaux, identifiants, sessions, base PostgreSQL, volume de blobs, navigateur et WebSocket.

**Step 4: Vérifier les liens Markdown**.

Run: `pnpm dlx markdownlint-cli2 "README.md" "docs/**/*.md"`
Expected: aucune erreur.

**Step 5: Commit**

```bash
git add README.md docs/
git commit -m "docs: define synapse architecture and threat model"
```

### Task 2: Initialiser le monorepo reproductible

**Objective:** Créer les workspaces Rust et pnpm avec des versions verrouillées et des commandes racine cohérentes.

**Files:**
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `deny.toml`
- Create: `crates/synapse-core/Cargo.toml`
- Create: `crates/synapse-core/src/lib.rs`
- Test: `crates/synapse-core/tests/workspace_smoke.rs`

**Step 1: Écrire le test de fumée**

```rust
use synapse_core::version;

#[test]
fn exposes_workspace_version() {
    assert_eq!(version(), env!("CARGO_PKG_VERSION"));
}
```

**Step 2: Vérifier RED**

Run: `cargo test -p synapse-core --test workspace_smoke`
Expected: FAIL, crate ou fonction `version` absente.

**Step 3: Ajouter l’implémentation minimale**

```rust
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
```

Définir à la racine les scripts `test`, `lint`, `format` et `typecheck`, puis verrouiller Rust et Node/pnpm.

**Step 4: Vérifier GREEN**

Run: `cargo test -p synapse-core --test workspace_smoke && pnpm install --frozen-lockfile=false`
Expected: 1 test Rust réussi et lockfile pnpm créé.

**Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock rust-toolchain.toml package.json pnpm-workspace.yaml pnpm-lock.yaml .editorconfig .gitignore deny.toml crates/
git commit -m "chore: initialize rust and pnpm workspaces"
```

### Task 3: Définir les types de domaine du coffre

**Objective:** Représenter les identifiants, chemins relatifs, versions et empreintes avec des types validés.

**Files:**
- Create: `crates/synapse-core/src/ids.rs`
- Create: `crates/synapse-core/src/path.rs`
- Create: `crates/synapse-core/src/version.rs`
- Modify: `crates/synapse-core/src/lib.rs`
- Test: `crates/synapse-core/tests/domain_types.rs`

**Step 1: Écrire un test refusant les traversals**

```rust
#[test]
fn vault_path_rejects_parent_segments() {
    let error = VaultPath::parse("notes/../../secret.md").unwrap_err();
    assert_eq!(error.to_string(), "vault path contains a parent segment");
}
```

**Step 2: Vérifier RED**

Run: `cargo test -p synapse-core --test domain_types vault_path_rejects_parent_segments`
Expected: FAIL, `VaultPath` absent.

**Step 3: Implémenter `VaultPath::parse`** en refusant chemin absolu, `..`, préfixe Windows, NUL, chemin vide et extension non autorisée pour une note.

**Step 4: Ajouter verticalement les tests** pour normalisation `/`, `VaultId`, `NoteId`, `OperationId`, `ContentHash` et `Revision` strictement positive.

**Step 5: Vérifier GREEN et propriétés**

Run: `cargo test -p synapse-core --test domain_types`
Expected: tous les tests passent.

**Step 6: Commit**

```bash
git add crates/synapse-core/
git commit -m "feat(core): add validated vault domain types"
```

### Task 4: Parser le Markdown et extraire les relations

**Objective:** Extraire titre, front matter, tags, wikilinks et empreinte sans modifier le contenu original.

**Files:**
- Create: `crates/synapse-core/src/markdown.rs`
- Modify: `crates/synapse-core/src/lib.rs`
- Create: `tests/fixtures/markdown/basic.md`
- Test: `crates/synapse-core/tests/markdown_parse.rs`

**Step 1: Écrire le premier test**

```rust
#[test]
fn extracts_wikilinks_without_changing_source() {
    let source = "# Projet\nVoir [[Roadmap|la feuille de route]].";
    let parsed = parse_note(source).unwrap();
    assert_eq!(parsed.wikilinks[0].target, "Roadmap");
    assert_eq!(parsed.wikilinks[0].alias.as_deref(), Some("la feuille de route"));
    assert_eq!(parsed.source, source);
}
```

**Step 2: Vérifier RED**, implémenter le strict minimum, puis vérifier GREEN.

Run: `cargo test -p synapse-core --test markdown_parse extracts_wikilinks_without_changing_source`
Expected RED puis PASS.

**Step 3: Répéter un cycle par comportement** : front matter YAML borné, tags Unicode, liens échappés, bloc de code ignoré, UTF-8 invalide signalé à la frontière fichier, document de 10 Mo limité.

**Step 4: Vérifier la suite**

Run: `cargo test -p synapse-core --test markdown_parse`
Expected: tous les cas passent sans snapshot non relu.

**Step 5: Commit**

```bash
git add crates/synapse-core/ tests/fixtures/markdown/
git commit -m "feat(core): parse markdown metadata and wikilinks"
```

### Task 5: Construire le stockage local SQLite

**Objective:** Persister l’index local et une outbox générique de payloads opaques dans SQLite, sans construire de protocole ou de ciphertext dans cette couche.

**Files:**
- Create: `crates/synapse-local-store/Cargo.toml`
- Create: `crates/synapse-local-store/src/lib.rs`
- Create: `crates/synapse-local-store/src/schema.rs`
- Create: `crates/synapse-local-store/migrations/0001_initial.sql`
- Test: `crates/synapse-local-store/tests/store.rs`
- Test: `crates/synapse-local-store/tests/transaction.rs`

**Step 1: Écrire un test d’ouverture/migration** utilisant une base temporaire réelle.

```rust
#[tokio::test]
async fn migration_creates_operation_queue() {
    let store = LocalStore::open_in_memory().await.unwrap();
    assert!(store.has_table("pending_operations").await.unwrap());
}
```

**Step 2: Vérifier RED**

Run: `cargo test -p synapse-local-store --test store migration_creates_operation_queue`
Expected: FAIL, crate/API absente.

**Step 3: Implémenter la migration minimale** avec `notes`, `links`, `revisions`, `pending_operations`, `sync_cursors` et une table virtuelle FTS5. La table d’outbox stocke un payload binaire opaque et des identifiants/versionnements validés ; elle ne connaît pas le Markdown et ne fabrique pas de payload de synchronisation.

**Step 4: Ajouter un cycle TDD par opération locale** : upsert atomique d’une note, suppression, recherche, insertion d’un payload opaque déjà construit par l’orchestrateur, ack, reprise après réouverture et rollback sur erreur. Ajouter une primitive publique unique, par exemple :

```rust
pub fn persist_note_and_operation(
    &mut self,
    note: &IndexedNote,
    links: &[String],
    operation: &PendingOperation,
) -> StoreResult<()>
```

Cette méthode ouvre une transaction SQLite mutable, met à jour `notes`, `revisions`, `links` et `pending_operations`, puis committe une seule fois. Une erreur sur n’importe quelle instruction provoque un rollback ; elle ne chiffre ni ne fabrique le payload.

**Step 5: Vérifier GREEN**

Run: `cargo test -p synapse-local-store --test store --test transaction`
Expected: tous les tests passent avec une vraie transaction SQLite ; le test d’échec volontaire prouve que l’index, les liens, la révision et l’outbox restent inchangés.

**Step 6: Commit**

```bash
git add Cargo.toml crates/synapse-local-store/
git commit -m "feat(storage): add sqlite local index and opaque operation outbox"
```

### Task 6: Implémenter le service de coffre local

**Objective:** Fournir uniquement les opérations filesystem sûres et atomiques du coffre, sans dépendance SQLite, crypto, réseau ou protocole.

**Files:**
- Create: `crates/synapse-core/src/vault.rs`
- Create: `crates/synapse-core/src/fs.rs`
- Test: `crates/synapse-core/tests/vault_service.rs`
- Create: `tests/fixtures/vault/.gitkeep`

**Step 1: Écrire le test de création atomique**

```rust
#[tokio::test]
async fn create_note_writes_markdown_inside_vault() {
    let vault = TestVault::new().await;
    vault.service.create_note("notes/hello.md", "# Hello").await.unwrap();
    assert_eq!(vault.read("notes/hello.md").await, "# Hello");
}
```

**Step 2: Vérifier RED**, implémenter écriture dans un fichier temporaire adjacent, `fsync`, puis renommage atomique.

**Step 3: Répéter TDD** pour lecture, renommage, suppression vers corbeille interne, collision, symlink sortant, permissions refusées, fichier modifié entre lecture/écriture, limites de taille et chemins multi-plateformes.

**Step 4: Ne pas ajouter d’index SQLite ni d’enqueue dans cette tâche.** L’orchestration disque → index → outbox chiffrée appartient à la Task 12a et au crate `synapse-vault-service`, conformément à `docs/adr/0004-local-vault-orchestration-boundary.md`.

**Step 5: Vérifier**

Run: `cargo test -p synapse-core --test vault_service`
Expected: tous les tests passent, aucun fichier n’est créé hors du répertoire temporaire et `synapse-core` ne dépend pas de `synapse-local-store`.

**Step 6: Commit**

```bash
git add crates/synapse-core/ tests/fixtures/vault/
git commit -m "feat(core): add safe local vault filesystem service"
```

### Task 7: Surveiller les modifications externes

**Objective:** Détecter les créations, modifications, renommages et suppressions externes sans boucle d’événements.

**Files:**
- Create: `crates/synapse-core/src/watcher.rs`
- Test: `crates/synapse-core/tests/watcher.rs`

**Step 1: Écrire un test d’événement externe** avec dossier temporaire et délai contrôlé.

**Step 2: Vérifier RED**, puis implémenter avec `notify`, debounce borné et canal Tokio.

**Step 3: Ajouter un test prouvant qu’une écriture interne n’est pas réimportée deux fois.**

**Step 4: Ajouter les cas renommage, rafale d’événements et disparition du dossier.**

**Step 5: Vérifier**

Run: `cargo test -p synapse-core --test watcher -- --test-threads=1`
Expected: tests stables sur Linux ; marquer les différences de plateforme explicitement, sans `sleep` arbitraire long.

**Step 6: Commit**

```bash
git add crates/synapse-core/
git commit -m "feat(core): watch external vault changes"
```

### Task 8: Créer le package UI Vue partagé

**Objective:** Mettre en place le shell d’application, les tokens de design et les composants accessibles partagés.

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/components/AppShell.vue`
- Create: `packages/ui/src/components/VaultTree.vue`
- Test: `packages/ui/src/components/__tests__/VaultTree.spec.ts`

**Step 1: Écrire le test de navigation clavier** avec Vitest et Vue Test Utils.

```ts
it('sélectionne la note suivante avec ArrowDown', async () => {
  const wrapper = mount(VaultTree, { props: { nodes } })
  await wrapper.get('[role="treeitem"]').trigger('keydown', { key: 'ArrowDown' })
  expect(wrapper.emitted('select')?.[0]).toEqual(['note-2'])
})
```

**Step 2: Vérifier RED**

Run: `pnpm --filter @synapse/ui test -- VaultTree.spec.ts`
Expected: FAIL, composant absent.

**Step 3: Implémenter le composant minimal**, puis ajouter par cycles séparés ARIA tree, sélection souris et état vide.

**Step 4: Vérifier type et tests**

Run: `pnpm --filter @synapse/ui typecheck && pnpm --filter @synapse/ui test`
Expected: aucune erreur TypeScript, tests verts.

**Step 5: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): add accessible vault application shell"
```

### Task 9: Créer l’éditeur et la prévisualisation Markdown

**Objective:** Fournir édition CodeMirror, autosauvegarde différée et rendu Markdown assaini.

**Files:**
- Create: `packages/ui/src/components/MarkdownEditor.vue`
- Create: `packages/ui/src/components/MarkdownPreview.vue`
- Create: `packages/ui/src/markdown/render.ts`
- Test: `packages/ui/src/components/__tests__/MarkdownEditor.spec.ts`
- Test: `packages/ui/src/markdown/render.spec.ts`

**Step 1: Écrire un test XSS**

```ts
it('supprime les scripts du rendu', () => {
  expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script')
})
```

**Step 2: Vérifier RED**, implémenter `markdown-it` avec HTML brut désactivé et assainissement DOM explicite, puis vérifier GREEN.

**Step 3: Écrire le test d’autosauvegarde** avec faux timers ; attendre un unique événement après une rafale.

**Step 4: Implémenter l’éditeur minimal**, sans accès direct au système de fichiers depuis Vue.

**Step 5: Vérifier**

Run: `pnpm --filter @synapse/ui test && pnpm --filter @synapse/ui typecheck`
Expected: tests XSS et autosauvegarde verts.

**Step 6: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): add secure markdown editor and preview"
```

### Task 10: Créer l’application desktop Tauri

**Objective:** Exposer au frontend Vue une API Tauri minimale et allowlistée pour les opérations du coffre.

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/App.vue`
- Create: `apps/desktop/src/stores/vault.ts`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands.rs`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Test: `apps/desktop/src-tauri/tests/commands.rs`
- Test: `apps/desktop/src/stores/vault.spec.ts`

**Step 1: Tester la commande `open_vault`** avec un adaptateur de dialogue injecté, sans ouvrir de vraie fenêtre.

**Step 2: Vérifier RED**, puis exposer uniquement `open_vault`, `list_notes`, `read_note`, `write_note`, `rename_note`, `trash_note` et `search_notes`.

**Step 3: Définir les capabilities Tauri minimales** ; ne pas accorder un accès global au shell ni au système de fichiers.

**Step 4: Écrire le test Pinia de chargement de l’arborescence**, puis connecter le store aux commandes typées.

**Step 5: Vérifier**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && pnpm --filter @synapse/desktop test && pnpm --filter @synapse/desktop tauri build --debug`
Expected: tests verts et bundle debug généré.

**Step 6: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): connect vue shell to tauri vault commands"
```

### Task 11: Ajouter recherche, backlinks et historique local

**Objective:** Rendre les fonctions locales principales utilisables sans serveur.

**Files:**
- Modify: `crates/synapse-local-store/src/lib.rs`
- Create: `crates/synapse-core/src/history.rs`
- Modify: `apps/desktop/src/stores/vault.ts`
- Create: `packages/ui/src/components/SearchPalette.vue`
- Create: `packages/ui/src/components/BacklinksPanel.vue`
- Create: `packages/ui/src/components/HistoryPanel.vue`
- Test: `crates/synapse-local-store/tests/search.rs`
- Test: `crates/synapse-core/tests/history.rs`
- Test: `packages/ui/src/components/__tests__/SearchPalette.spec.ts`

**Step 1: TDD recherche FTS5** : termes, préfixes, accents, note supprimée et limite de résultats.

**Step 2: TDD backlinks** : reconstruire seulement les relations de la note modifiée.

**Step 3: TDD historique** : conserver révision, hash, date, auteur local et restaurer via une nouvelle révision plutôt qu’un écrasement.

**Step 4: TDD composants Vue** : raccourci clavier, résultats accessibles, backlinks navigables et confirmation de restauration.

**Step 5: Vérifier**

Run: `cargo test -p synapse-local-store -p synapse-core && pnpm --filter @synapse/ui test`
Expected: suites Rust et Vue vertes.

**Step 6: Commit**

```bash
git add crates/ apps/desktop/ packages/ui/
git commit -m "feat: add local search backlinks and history"
```

### Task 11a: Implémenter le chiffrement de coffre côté client

**Objective:** Chiffrer et déchiffrer les contenus synchronisés sans jamais exposer la clé de coffre ou le Markdown au serveur.

**Files:**
- Create: `crates/synapse-crypto/Cargo.toml`
- Create: `crates/synapse-crypto/src/lib.rs`
- Create: `crates/synapse-crypto/src/kdf.rs`
- Create: `crates/synapse-crypto/src/envelope.rs`
- Create: `crates/synapse-crypto/src/content.rs`
- Test: `crates/synapse-crypto/tests/e2ee.rs`
- Create: `docs/security/e2ee-design.md`

**Step 1: Écrire le test de round-trip XChaCha20-Poly1305** : chiffrer une note avec une clé de coffre aléatoire, puis vérifier que seul le bon AAD (`vault_id`, `note_id`, `revision`) permet le déchiffrement.

**Step 2: Vérifier RED**

Run: `cargo test -p synapse-crypto --test e2ee encrypt_then_decrypts_with_matching_aad`
Expected: FAIL, module de chiffrement absent.

**Step 3: Implémenter le minimum** : générer une clé de coffre 256 bits avec l’OS CSPRNG ; dériver une clé de wrapping depuis la phrase secrète via Argon2id et un sel unique ; wrapper la clé de coffre ; chiffrer contenu et pièces jointes avec nonce unique et AAD versionné.

**Step 4: Répéter TDD** pour mauvais mot de passe, ciphertext altéré, nonce réutilisé refusé par l’API, AAD différent, sérialisation déterministe de l’enveloppe, et absence de clé/contenu dans `Debug` ou logs.

**Step 5: Documenter les limites** : phrase secrète perdue = coffre non récupérable ; changement de phrase secrète nécessite re-wrapping local ; aucun partage E2EE entre comptes dans le MVP.

**Step 6: Vérifier GREEN**

Run: `cargo test -p synapse-crypto --test e2ee && cargo clippy -p synapse-crypto --all-targets -- -D warnings`
Expected: tous les cas cryptographiques et linter passent.

**Step 7: Commit**

```bash
git add crates/synapse-crypto/ docs/security/e2ee-design.md Cargo.toml Cargo.lock
git commit -m "feat(crypto): add client side vault encryption"
```

### Task 12: Définir le protocole de synchronisation chiffré v1

**Objective:** Créer des contrats stables où le serveur ne manipule que des ciphertexts, enveloppes de clés et métadonnées minimales.

**Files:**
- Create: `crates/synapse-protocol/Cargo.toml`
- Create: `crates/synapse-protocol/src/lib.rs`
- Create: `crates/synapse-protocol/src/v1.rs`
- Create: `crates/synapse-protocol/schema/openapi.json`
- Test: `crates/synapse-protocol/tests/contract.rs`
- Create: `docs/architecture/sync-v1.md`

**Step 1: Écrire le test de round-trip** pour `EncryptedPushOperation`, `PullRequest`, `PullResponse`, `Conflict` et `SyncCursor`.

```rust
#[test]
fn encrypted_push_json_never_contains_plaintext() {
    let value = serde_json::to_value(fixture_encrypted_operation()).unwrap();
    assert_eq!(value["protocol_version"], 1);
    assert!(value.get("operation_id").is_some());
    assert!(value.get("base_revision").is_some());
    assert!(value.get("ciphertext").is_some());
    assert!(value.to_string().contains("# note secrète").not());
}
```

**Step 2: Vérifier RED**, puis ajouter les types serde avec `deny_unknown_fields` aux entrées sensibles. Le contrat contient `ciphertext`, `nonce`, `aad_version`, `ciphertext_hash` et, à la création du coffre, l’enveloppe chiffrée de la clé de coffre ; il ne contient jamais un titre, un chemin, un tag ou un extrait Markdown en clair.

**Step 3: Ajouter des golden tests** pour compatibilité JSON, AAD stable et génération OpenAPI déterministe.

**Step 4: Documenter les transitions** : `pending → accepted|conflict|rejected`, pagination et reprise. En conflit, le serveur retourne les références aux trois blobs chiffrés ; seul le client déverrouillé peut exécuter une fusion trois voies.

**Step 5: Vérifier**

Run: `cargo test -p synapse-protocol && git diff --exit-code crates/synapse-protocol/schema/openapi.json`
Expected: tests verts, aucun champ de contenu en clair et génération stable.

**Step 6: Commit**

```bash
git add crates/synapse-protocol/ docs/architecture/sync-v1.md
git commit -m "feat(protocol): define encrypted versioned sync contracts"
```

### Task 12a: Orchestrer le coffre local, l’index et l’outbox chiffrée

**Objective:** Relier le service filesystem, SQLite, la crypto et le protocole sans créer de dépendance circulaire ni prétendre à une transaction ACID inter-systèmes.

**Files:**
- Create: `crates/synapse-vault-service/Cargo.toml`
- Create: `crates/synapse-vault-service/src/lib.rs`
- Create: `crates/synapse-vault-service/src/reconcile.rs`
- Modify: `crates/synapse-local-store/src/lib.rs`
- Test: `crates/synapse-local-store/tests/transaction.rs`
- Test: `crates/synapse-vault-service/tests/mutation.rs`
- Test: `crates/synapse-vault-service/tests/recovery.rs`
- Modify: `Cargo.toml`
- Modify: `docs/adr/0004-local-vault-orchestration-boundary.md`

**Step 1: Écrire le test de mutation complète** : écrire atomiquement le fichier local, parser/indexer dans SQLite local, construire le payload protocolaire chiffré avec la clé de coffre, puis insérer l’outbox et l’index dans une transaction SQLite unique.

**Step 2: Vérifier RED**

Run: `cargo test -p synapse-vault-service --test mutation`
Expected: FAIL, crate d’orchestration absente.

**Step 3: Implémenter la couche minimale** avec les dépendances `synapse-core`, `synapse-local-store`, `synapse-crypto` et `synapse-protocol`. Valider `note`, parser les liens, chiffrer/serializer le payload puis appeler l’unique primitive mutable `LocalStore::persist_note_and_operation(&mut self, &note, &links, &operation)`. `synapse-core` et `synapse-local-store` ne dépendent jamais de cette couche.

**Step 4: TDD récupération** : simuler un crash après le renommage filesystem mais avant le commit SQLite ; au redémarrage, le reconciler détecte l’écart, réindexe la note et crée l’outbox chiffrée exactement une fois grâce à l’empreinte/opération idempotente.

**Step 5: TDD rollback** : injecter une erreur dans la mutation SQLite après l’upsert mais avant le commit ; vérifier que `notes`, `revisions`, `links` et `pending_operations` restent dans leur état précédent. Une panne après le commit SQLite mais avant l’ack est récupérée par rejeu idempotent.

**Step 6: Vérifier**

Run: `cargo test -p synapse-vault-service --test mutation --test recovery && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: flux complet, crash recovery, idempotence et dépendances acycliques verts ; aucun payload en clair dans `pending_operations`.

**Step 7: Commit**

```bash
git add Cargo.toml Cargo.lock crates/synapse-vault-service/ docs/adr/0004-local-vault-orchestration-boundary.md
git commit -m "feat(vault): orchestrate local index and encrypted outbox"
```

### Task 13: Initialiser le serveur Axum et PostgreSQL

**Objective:** Démarrer une API avec configuration validée, pool PostgreSQL, migrations et health checks.

**Files:**
- Create: `apps/server/Cargo.toml`
- Create: `apps/server/src/main.rs`
- Create: `apps/server/src/lib.rs`
- Create: `apps/server/src/config.rs`
- Create: `apps/server/src/http/health.rs`
- Create: `migrations/0001_initial.sql`
- Test: `apps/server/tests/health.rs`
- Create: `.env.example`

**Step 1: Écrire le test `/health/live`** sans PostgreSQL.

**Step 2: Vérifier RED**, implémenter le router minimal et obtenir `200 {"status":"ok"}`.

**Step 3: Écrire `/health/ready`** qui échoue sans base et réussit après migration sur une PostgreSQL de test.

**Step 4: Créer les tables minimales** : `users`, `sessions`, `invites`, `vaults`, `vault_members` (préparée, sans partage E2EE MVP), `encrypted_vault_keys`, `revisions`, `operations`, `sync_cursors`, `blobs`. Les tables ne contiennent aucun titre, chemin, tag ou contenu Markdown en clair ; les identifiants de notes et chemins sont chiffrés dans le payload client.

**Step 5: Vérifier**

Run: `docker compose -f infra/docker/compose.test.yml up -d postgres && cargo test -p synapse-server --test health`
Expected: liveness et readiness verts ; migrations rejouables.

**Step 6: Commit**

```bash
git add apps/server/ migrations/ .env.example infra/docker/compose.test.yml
git commit -m "feat(server): add axum service and postgres schema"
```

### Task 14: Implémenter inscription, connexion et sessions

**Objective:** Protéger l’API par des sessions serveur révocables et des mots de passe Argon2id.

**Files:**
- Create: `apps/server/src/auth/mod.rs`
- Create: `apps/server/src/auth/password.rs`
- Create: `apps/server/src/auth/session.rs`
- Create: `apps/server/src/http/auth.rs`
- Test: `apps/server/tests/auth.rs`

**Step 1: TDD hash de mot de passe** : le hash diffère du secret et la vérification réussit.

**Step 2: TDD création de compte** : email normalisé, mot de passe minimal, doublon générique sans fuite d’information, invitation valide obligatoire par défaut, et création de l’administrateur initial seulement via variable d’environnement consommée après initialisation. Ajouter `SYNAPSE_ALLOW_PUBLIC_SIGNUP=false` comme défaut explicite.

**Step 3: TDD connexion** : cookie opaque `HttpOnly; Secure; SameSite=Strict`, hash de session côté base, rotation après authentification. Le mot de passe d’authentification reste distinct des secrets de wrapping E2EE : le serveur ne reçoit jamais la clé de coffre ni une phrase secrète de déchiffrement.

**Step 4: TDD révocation et expiration** avec horloge injectée.

**Step 5: Ajouter limitation de débit** sur inscription et connexion via Tower.

**Step 6: Vérifier**

Run: `cargo test -p synapse-server --test auth`
Expected: succès, erreurs, expiration et rate limiting verts ; aucun secret dans les logs capturés.

**Step 7: Commit**

```bash
git add apps/server/src/auth/ apps/server/src/http/auth.rs apps/server/tests/auth.rs
git commit -m "feat(server): add argon2 authentication and secure sessions"
```

### Task 15: Implémenter les coffres et autorisations

**Objective:** Autoriser un utilisateur à créer et consulter uniquement ses propres coffres.

**Files:**
- Create: `apps/server/src/http/vaults.rs`
- Create: `apps/server/src/repository/vaults.rs`
- Test: `apps/server/tests/vault_authorization.rs`

**Step 1: TDD création d’un coffre authentifié.**

**Step 2: TDD refus `401` sans session et `404` plutôt que fuite d’existence pour le coffre d’un tiers.**

**Step 3: TDD unicité et limites de taille/nom.**

**Step 4: Implémenter les requêtes SQLx paramétrées et contraintes SQL.**

**Step 5: Vérifier**

Run: `cargo test -p synapse-server --test vault_authorization`
Expected: matrice propriétaire/inconnu/non authentifié verte.

**Step 6: Commit**

```bash
git add apps/server/src/http/vaults.rs apps/server/src/repository/vaults.rs apps/server/tests/vault_authorization.rs
git commit -m "feat(server): add vault ownership authorization"
```

### Task 16: Implémenter le stockage de blobs chiffrés

**Objective:** Stocker des ciphertexts adressés par l’empreinte du ciphertext derrière une interface remplaçable, sans traversal ni duplication.

**Files:**
- Create: `apps/server/src/blob/mod.rs`
- Create: `apps/server/src/blob/filesystem.rs`
- Test: `apps/server/tests/blob_store.rs`

**Step 1: Définir le trait `BlobStore`** avec `put_ciphertext`, `get_ciphertext`, `exists` et `delete_unreferenced` ; l’interface ne prend jamais de Markdown en clair.

**Step 2: TDD déduplication** : deux ciphertexts octet-à-octet identiques créent un seul blob ; deux chiffrages d’un même texte avec nonces distincts restent deux blobs valides.

**Step 3: TDD intégrité** : refuser une empreinte annoncée différente du SHA-256 du ciphertext reçu ; le serveur ne tente jamais de déchiffrer.

**Step 4: TDD sécurité** : aucun identifiant arbitraire ne devient un chemin ; permissions de fichier restrictives.

**Step 5: Vérifier**

Run: `cargo test -p synapse-server --test blob_store`
Expected: déduplication, intégrité des ciphertexts et sécurité vertes.

**Step 6: Commit**

```bash
git add apps/server/src/blob/ apps/server/tests/blob_store.rs
git commit -m "feat(server): add encrypted content addressed blobs"
```

### Task 17: Implémenter le push idempotent

**Objective:** Accepter une opération locale une seule fois, créer une révision et retourner le même résultat en cas de rejeu.

**Files:**
- Create: `apps/server/src/http/sync.rs`
- Create: `apps/server/src/sync/apply.rs`
- Test: `apps/server/tests/sync_push.rs`

**Step 1: TDD premier push** : version de base courante, ciphertext et AAD structurel valides, révision suivante créée sans tentative de déchiffrement côté serveur.

**Step 2: TDD rejeu** : même `operation_id` retourne le résultat initial sans nouvelle révision.

**Step 3: TDD transaction** : panne du blob ou de PostgreSQL ne laisse pas d’état partiel observable.

**Step 4: TDD autorisation, taille maximale, hash de ciphertext invalide et métadonnée en clair interdite.**

**Step 5: Vérifier**

Run: `cargo test -p synapse-server --test sync_push`
Expected: push et rejeu verts, compte de révisions inchangé au rejeu.

**Step 6: Commit**

```bash
git add apps/server/src/http/sync.rs apps/server/src/sync/ apps/server/tests/sync_push.rs
git commit -m "feat(sync): accept idempotent push operations"
```

### Task 18: Implémenter pull, curseurs et pagination

**Objective:** Retourner seulement les opérations postérieures au curseur, dans un ordre stable et reprenable.

**Files:**
- Create: `apps/server/src/sync/pull.rs`
- Modify: `apps/server/src/http/sync.rs`
- Test: `apps/server/tests/sync_pull.rs`

**Step 1: TDD pull initial paginé.**

**Step 2: TDD curseur suivant** : aucun doublon ni trou entre deux pages.

**Step 3: TDD curseur invalide/ancien** : erreur versionnée proposant un resnapshot contrôlé.

**Step 4: TDD isolation entre coffres et utilisateurs.**

**Step 5: Vérifier**

Run: `cargo test -p synapse-server --test sync_pull`
Expected: ordre déterministe et reprise sans doublon.

**Step 6: Commit**

```bash
git add apps/server/src/sync/pull.rs apps/server/src/http/sync.rs apps/server/tests/sync_pull.rs
git commit -m "feat(sync): add cursor based incremental pull"
```

### Task 19: Détecter et préserver les conflits chiffrés

**Objective:** Empêcher l’écrasement d’une révision distante lorsque la base locale est obsolète, sans demander au serveur de lire le contenu.

**Files:**
- Create: `crates/synapse-sync/Cargo.toml`
- Create: `crates/synapse-sync/src/conflict.rs`
- Create: `apps/server/src/sync/conflict.rs`
- Test: `crates/synapse-sync/tests/conflict.rs`
- Test: `apps/server/tests/sync_conflict.rs`

**Step 1: TDD serveur** : une `base_revision` obsolète retourne `Conflict` avec références aux blobs chiffrés base/locale/distante ; aucune fusion n’est exécutée côté serveur.

**Step 2: TDD client déverrouillé** : déchiffrer les trois versions et n’accepter une fusion trois voies que lorsque les hunks sont disjoints et le résultat est re-chiffré comme nouvelle révision.

**Step 3: TDD modifications chevauchantes** : conserver toutes les variantes et créer l’état `manual_resolution_required`, sans modifier le fichier local.

**Step 4: TDD résolution** : une résolution crée une nouvelle révision chiffrée auditable et ne supprime pas l’historique.

**Step 5: Vérifier**

Run: `cargo test -p synapse-sync && cargo test -p synapse-server --test sync_conflict`
Expected: aucun scénario concurrent ne perd de contenu et aucun test serveur ne dépend de Markdown en clair.

**Step 6: Commit**

```bash
git add crates/synapse-sync/ apps/server/src/sync/ apps/server/tests/sync_conflict.rs
git commit -m "feat(sync): preserve encrypted concurrent edits"
```

### Task 20: Connecter la file locale au serveur

**Objective:** Envoyer les opérations en attente, tirer les nouveautés et reprendre après coupure.

**Files:**
- Create: `crates/synapse-sync/src/client.rs`
- Create: `crates/synapse-sync/src/engine.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Create: `crates/synapse-sync/tests/offline_recovery.rs`

**Step 1: TDD operation hors ligne** : elle reste `pending` après erreur réseau.

**Step 2: TDD reconnexion** : retry borné avec backoff + jitter injectables, puis ack seulement après réponse serveur.

**Step 3: TDD crash entre push et ack** : le rejeu idempotent vide la file sans doublon serveur.

**Step 4: TDD pull concurrent et conflit** : état UI devient `conflict` sans remplacer le fichier local.

**Step 5: Vérifier**

Run: `cargo test -p synapse-sync --test offline_recovery`
Expected: scénarios coupure/reprise et crash/rejeu verts.

**Step 6: Commit**

```bash
git add crates/synapse-sync/ apps/desktop/src-tauri/
git commit -m "feat(desktop): synchronize queued operations after reconnect"
```

### Task 21: Ajouter les notifications WebSocket

**Objective:** Réveiller les clients lorsqu’un coffre reçoit une nouvelle révision, sans remplacer le pull durable.

**Files:**
- Create: `apps/server/src/http/ws.rs`
- Modify: `apps/server/src/lib.rs`
- Modify: `crates/synapse-sync/src/client.rs`
- Test: `apps/server/tests/websocket.rs`

**Step 1: TDD authentification du handshake.**

**Step 2: TDD notification après commit uniquement** avec `vault_id` et nouveau curseur, sans contenu de note.

**Step 3: TDD déconnexion/reconnexion** : le client exécute un pull depuis son curseur, donc aucune notification perdue n’entraîne une perte de données.

**Step 4: Ajouter heartbeat, limite de connexions et fermeture propre.**

**Step 5: Vérifier**

Run: `cargo test -p synapse-server --test websocket && cargo test -p synapse-sync`
Expected: handshake, notification et reprise verts.

**Step 6: Commit**

```bash
git add apps/server/ crates/synapse-sync/
git commit -m "feat(sync): notify clients through authenticated websocket"
```

### Task 22: Générer le client TypeScript OpenAPI

**Objective:** Éviter la duplication manuelle des contrats entre Rust et Vue.

**Files:**
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/src/index.ts`
- Create: `packages/api-client/scripts/generate.mjs`
- Test: `packages/api-client/src/index.spec.ts`
- Modify: `package.json`

**Step 1: Écrire un test de sérialisation** d’un push depuis TypeScript contre le golden JSON Rust.

**Step 2: Vérifier RED**, générer types et client depuis `crates/synapse-protocol/schema/openapi.json`.

**Step 3: Ajouter une vérification CI de dérive** : génération puis `git diff --exit-code`.

**Step 4: Vérifier**

Run: `pnpm --filter @synapse/api-client generate && pnpm --filter @synapse/api-client test && git diff --exit-code packages/api-client/src/generated`
Expected: client généré stable et test vert.

**Step 5: Commit**

```bash
git add packages/api-client/ package.json pnpm-lock.yaml
git commit -m "feat(protocol): generate typescript api client"
```

### Task 23: Créer l’application web Vue

**Objective:** Permettre authentification, déverrouillage local du coffre, navigation, édition et synchronisation depuis un navigateur.

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.vue`
- Create: `apps/web/src/router.ts`
- Create: `apps/web/src/stores/auth.ts`
- Create: `apps/web/src/stores/vault.ts`
- Create: `apps/web/src/crypto/vault-key.ts`
- Create: `apps/web/src/views/LoginView.vue`
- Create: `apps/web/src/views/UnlockVaultView.vue`
- Create: `apps/web/src/views/VaultView.vue`
- Test: `apps/web/src/stores/auth.spec.ts`
- Test: `apps/web/src/stores/vault.spec.ts`
- Test: `apps/web/src/crypto/vault-key.spec.ts`

**Step 1: TDD garde de route** : un utilisateur non authentifié va vers `/login` ; un coffre chiffré non déverrouillé va vers `/unlock`.

**Step 2: TDD connexion** avec cookie serveur et protection CSRF sur les mutations.

**Step 3: TDD déverrouillage** : l’enveloppe de clé est déchiffrée seulement dans la mémoire du navigateur ; la clé n’est jamais placée dans Pinia persisté, `localStorage`, URL, logs ou requêtes API.

**Step 4: TDD chargement paginé du coffre**, déchiffrement local, édition et push chiffré via `@synapse/api-client`.

**Step 5: TDD état de synchronisation** : `saving`, `synced`, `offline`, `conflict`, `error`.

**Step 6: Vérifier**

Run: `pnpm --filter @synapse/web test && pnpm --filter @synapse/web typecheck && pnpm --filter @synapse/web build`
Expected: tests, types et build statique verts.

**Step 7: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add encrypted authenticated vault editor"
```

### Task 24: Ajouter un cache web complet et chiffré hors ligne

**Objective:** Conserver une copie complète des notes, pièces jointes et opérations dans IndexedDB sous forme de ciphertexts, puis permettre leur déchiffrement local après déverrouillage.

**Files:**
- Create: `apps/web/src/offline/db.ts`
- Create: `apps/web/src/offline/cache.ts`
- Create: `apps/web/src/offline/queue.ts`
- Create: `apps/web/src/sw.ts`
- Test: `apps/web/src/offline/cache.spec.ts`
- Test: `apps/web/src/offline/queue.spec.ts`
- Test: `tests/e2e/web-offline.spec.ts`

**Step 1: TDD persistance IndexedDB** d’une liste complète de ciphertexts, enveloppes nécessaires, curseur et opérations ; vérifier qu’un extrait Markdown en clair n’est jamais écrit dans IndexedDB.

**Step 2: TDD reprise** : ouvrir l’application hors ligne, déverrouiller le coffre, lire/éditer le cache local, puis pousser idempotemment après reconnexion et supprimer seulement les opérations ackées.

**Step 3: Ajouter un service worker** limité aux assets versionnés ; ne jamais mettre en cache une réponse privée partagée entre utilisateurs.

**Step 4: TDD logout/verrouillage** : purger la clé en mémoire ; conserver les ciphertexts de cache sauf choix utilisateur « effacer les données de cet appareil ».

**Step 5: TDD déconnexion Playwright** avec `context.setOffline(true/false)`.

**Step 6: Vérifier**

Run: `pnpm --filter @synapse/web test && pnpm playwright test tests/e2e/web-offline.spec.ts`
Expected: copie complète disponible après déverrouillage hors ligne et synchronisée après reconnexion, sans clair persistant.

**Step 7: Commit**

```bash
git add apps/web/ tests/e2e/web-offline.spec.ts
git commit -m "feat(web): cache complete encrypted vault offline"
```

### Task 25: Créer l’interface de résolution des conflits

**Objective:** Comparer base, local et distant puis créer explicitement une révision résolue.

**Files:**
- Create: `packages/ui/src/components/ConflictResolver.vue`
- Modify: `apps/desktop/src/stores/vault.ts`
- Modify: `apps/web/src/stores/vault.ts`
- Test: `packages/ui/src/components/__tests__/ConflictResolver.spec.ts`
- Test: `tests/e2e/conflict-resolution.spec.ts`

**Step 1: TDD affichage des trois versions** sans exécuter le HTML contenu.

**Step 2: TDD actions** garder local, garder distant et édition manuelle ; chacune demande confirmation.

**Step 3: TDD requête de résolution** portant l’identifiant du conflit et les hashes attendus.

**Step 4: E2E avec deux contextes** modifiant la même note hors ligne puis se reconnectant.

**Step 5: Vérifier**

Run: `pnpm --filter @synapse/ui test && pnpm playwright test tests/e2e/conflict-resolution.spec.ts`
Expected: conflit visible, deux variantes préservées, résolution synchronisée.

**Step 6: Commit**

```bash
git add packages/ui/ apps/desktop/ apps/web/ tests/e2e/conflict-resolution.spec.ts
git commit -m "feat(ui): add non destructive conflict resolution"
```

### Task 26: Durcir l’API et le client

**Objective:** Appliquer les contrôles du modèle de menace avant exposition réseau.

**Files:**
- Create: `apps/server/src/http/security.rs`
- Create: `apps/server/tests/security_headers.rs`
- Create: `apps/server/tests/path_traversal.rs`
- Create: `apps/server/tests/csrf.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `docs/security/hardening.md`

**Step 1: TDD en-têtes** CSP, HSTS en production, `X-Content-Type-Options`, `Referrer-Policy` et politique CORS allowlist.

**Step 2: TDD CSRF** sur chaque mutation cookie-authentifiée.

**Step 3: TDD limites** body, upload, profondeur JSON, timeout, connexions WebSocket et rate limiting.

**Step 4: TDD traversal/symlink** avec corpus Linux et Windows.

**Step 5: Auditer capabilities Tauri** et supprimer tout accès shell/réseau/fichier non requis.

**Step 6: Vérifier**

Run: `cargo test -p synapse-server security && cargo test -p synapse-core vault_path && pnpm audit --prod && cargo deny check`
Expected: suites vertes et aucune vulnérabilité/licence interdite non justifiée.

**Step 7: Commit**

```bash
git add apps/server/ apps/desktop/src-tauri/ docs/security/
git commit -m "security: harden server and desktop capabilities"
```

### Task 27: Ajouter observabilité respectueuse des données

**Objective:** Produire logs structurés, métriques et traces sans contenu sensible.

**Files:**
- Create: `apps/server/src/telemetry.rs`
- Create: `apps/server/src/metrics.rs`
- Test: `apps/server/tests/telemetry.rs`
- Create: `docs/operations/observability.md`

**Step 1: TDD redaction** : mot de passe, cookie, token et contenu Markdown n’apparaissent jamais dans les logs capturés.

**Step 2: Ajouter request ID et traces OpenTelemetry** sans payload.

**Step 3: Ajouter métriques Prometheus** : latence, erreurs, opérations push/pull, conflits, taille de file, connexions WS ; pas de label utilisateur/coffre à forte cardinalité.

**Step 4: Vérifier**

Run: `cargo test -p synapse-server --test telemetry`
Expected: redaction et noms de métriques verts.

**Step 5: Commit**

```bash
git add apps/server/src/telemetry.rs apps/server/src/metrics.rs apps/server/tests/telemetry.rs docs/operations/observability.md
git commit -m "feat(ops): add privacy safe telemetry"
```

### Task 28: Créer le déploiement Docker Compose

**Objective:** Démarrer Synapse avec PostgreSQL, stockage persistant, migrations et Caddy sans service payant.

**Files:**
- Create: `apps/server/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `docker-compose.yml`
- Create: `infra/caddy/Caddyfile`
- Create: `infra/docker/compose.test.yml`
- Create: `infra/docker/healthcheck.sh`
- Modify: `.env.example`
- Test: `tests/integration/self_hosted.sh`
- Create: `docs/operations/install.md`

**Step 1: Écrire le test shell d’installation** : build, démarrage, health check, création de compte, arrêt et redémarrage avec données persistées.

**Step 2: Vérifier RED**

Run: `bash tests/integration/self_hosted.sh`
Expected: FAIL, Compose/images absents.

**Step 3: Créer des images multi-stage non-root**, filesystem racine en lecture seule quand possible, health checks et volumes nommés.

**Step 4: Ajouter profils Compose** : `default` minimal ; `observability` optionnel. Ne pas inclure MinIO dans le chemin minimal.

**Step 5: Vérifier GREEN**

Run: `bash tests/integration/self_hosted.sh`
Expected: installation saine et persistance après redémarrage.

**Step 6: Commit**

```bash
git add apps/server/Dockerfile apps/web/Dockerfile docker-compose.yml infra/ tests/integration/self_hosted.sh .env.example docs/operations/install.md
git commit -m "feat(ops): add self hosted compose deployment"
```

### Task 29: Ajouter sauvegarde, restauration et migrations

**Objective:** Prouver que PostgreSQL et les blobs peuvent être sauvegardés et restaurés de façon cohérente.

**Files:**
- Create: `infra/scripts/backup.sh`
- Create: `infra/scripts/restore.sh`
- Create: `infra/scripts/migrate.sh`
- Test: `tests/integration/backup_restore.sh`
- Create: `docs/operations/backup-restore.md`
- Create: `docs/operations/upgrades.md`

**Step 1: Écrire le scénario RED** : créer utilisateur/coffre/note, sauvegarder, détruire les volumes, restaurer et vérifier hash/contenu.

**Step 2: Implémenter une sauvegarde versionnée** contenant dump PostgreSQL, blobs et manifeste d’empreintes ; documenter la nécessité d’un snapshot cohérent.

**Step 3: Refuser une restauration destructive sans confirmation explicite et vérifier l’espace disponible.**

**Step 4: Vérifier GREEN**

Run: `bash tests/integration/backup_restore.sh`
Expected: contenu et métadonnées identiques après restauration.

**Step 5: Commit**

```bash
git add infra/scripts/ tests/integration/backup_restore.sh docs/operations/
git commit -m "feat(ops): add tested backup and restore workflow"
```

### Task 30: Établir les budgets de performance

**Objective:** Mesurer les chemins critiques et empêcher les régressions majeures.

**Files:**
- Create: `crates/synapse-core/benches/markdown.rs`
- Create: `crates/synapse-local-store/benches/search.rs`
- Create: `tests/load/sync.js`
- Create: `tests/fixtures/generator/src/main.rs`
- Create: `docs/architecture/performance-budgets.md`

**Step 1: Générer un coffre déterministe** de 10 000 notes avec tailles et liens réalistes.

**Step 2: Ajouter benchmarks Criterion** pour parse incrémental, indexation et recherche.

**Step 3: Ajouter test de charge k6** open source pour push/pull/WebSocket avec 100 clients et documenter la machine de référence.

**Step 4: Fixer des budgets initiaux mesurés**, pas inventés ; échouer seulement sur régression statistiquement significative.

**Step 5: Vérifier**

Run: `cargo bench -p synapse-core -p synapse-local-store && k6 run tests/load/sync.js`
Expected: rapports produits et budgets consignés.

**Step 6: Commit**

```bash
git add crates/*/benches tests/load/ tests/fixtures/generator/ docs/architecture/performance-budgets.md
git commit -m "perf: add vault and sync benchmarks"
```

### Task 31: Mettre en place les contrôles qualité et la CI libre

**Objective:** Automatiser formatage, tests, audits, SBOM et builds sur une CI auto-hébergeable.

**Files:**
- Create: `.forgejo/workflows/ci.yml`
- Create: `.forgejo/workflows/release.yml`
- Create: `justfile`
- Modify: `package.json`
- Create: `docs/operations/ci.md`

**Step 1: Ajouter la commande locale unique** `just verify` exécutant format check, clippy, nextest, Vitest, typecheck, Playwright ciblé, cargo-deny et audit pnpm.

**Step 2: Exécuter RED** avant correction de tous les écarts.

Run: `just verify`
Expected: échoue tant qu’un contrôle manque ou qu’un test échoue.

**Step 3: Créer le workflow Forgejo Actions** avec cache non obligatoire, PostgreSQL de service, artefacts de test et permissions minimales.

**Step 4: Générer une SBOM CycloneDX** pour Rust et Node ; stocker les artefacts de release, pas dans Git.

**Step 5: Vérifier GREEN**

Run: `just verify`
Expected: tous les contrôles passent depuis un environnement propre.

**Step 6: Commit**

```bash
git add .forgejo/ justfile package.json pnpm-lock.yaml docs/operations/ci.md
git commit -m "ci: add self hosted quality and security gates"
```

### Task 32: Valider le parcours vertical complet

**Objective:** Prouver le parcours desktop → serveur → web → conflit → restauration sur un environnement réel.

**Files:**
- Create: `tests/e2e/full-sync.spec.ts`
- Create: `tests/e2e/desktop.spec.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `docs/testing/release-checklist.md`
- Modify: `README.md`

**Step 1: Écrire le test desktop** : ouvrir un coffre, créer une note, travailler hors ligne, reconnecter et attendre `synced`.

**Step 2: Écrire le test web** : se connecter, retrouver et modifier la note.

**Step 3: Créer un conflit réel** entre desktop hors ligne et web, vérifier la présence des deux variantes, puis le résoudre.

**Step 4: Redémarrer la stack**, vérifier persistance, exécuter sauvegarde/restauration et revérifier le contenu.

**Step 5: Exécuter la validation complète**

Run: `just verify && bash tests/integration/self_hosted.sh && pnpm playwright test tests/e2e/full-sync.spec.ts`
Expected: toutes les suites passent ; aucun avertissement de sécurité non traité.

**Step 6: Mettre à jour le README** avec uniquement des commandes réellement vérifiées, captures facultatives et limites connues.

**Step 7: Commit**

```bash
git add tests/e2e/ docs/testing/ README.md
git commit -m "test: validate end to end synapse workflow"
```

---

## 5. Ordre des jalons

### Milestone 0 — Architecture prête

Tasks 1–3. Sortie : décisions documentées, workspaces reproductibles et types de domaine sûrs.

### Milestone 1 — Application locale chiffrée utilisable

Tasks 4–11 et 11a. Sortie : client desktop hors ligne capable d’éditer, rechercher, suivre les backlinks, restaurer l’historique et chiffrer les données destinées à la synchronisation.

### Milestone 2 — Synchronisation serveur chiffrée et fiable

Tasks 12, 12a–22. Sortie : protocole chiffré, orchestration locale sans cycle Cargo, authentification multi-utilisateur, stockage opaque, push/pull idempotent, conflits chiffrés préservés, reprise et notifications temps réel.

### Milestone 3 — Accès web chiffré et offline

Tasks 23–25. Sortie : web Vue fonctionnel, déverrouillage local, cache complet chiffré et résolution de conflits partagée.

### Milestone 4 — Self-hosting sécurisé

Tasks 26–31. Sortie : durcissement, observabilité, Compose, sauvegarde/restauration, benchmarks et CI libre.

### Milestone 5 — MVP validé

Task 32. Sortie : parcours complet vérifié et documentation honnête, prête pour une préversion.

## 6. Matrice de tests

| Niveau | Outil | Cible | Commande principale |
|---|---|---|---|
| Unitaire Rust | cargo-nextest | domaine, protocole, sync, stockage | `cargo nextest run --workspace` |
| Propriétés Rust | proptest | chemins, versions, sérialisation | `cargo nextest run --workspace` |
| Unitaire Vue | Vitest | stores, composants, sécurité rendu | `pnpm test` |
| Intégration DB | SQLx + PostgreSQL réel | migrations, auth, push/pull | `cargo nextest run -p synapse-server` |
| Desktop | tests Rust + Webdriver Tauri selon disponibilité | commandes et parcours local | `pnpm --filter @synapse/desktop test:e2e` |
| Web E2E | Playwright | auth, offline, conflit | `pnpm playwright test` |
| Self-host | Bash + Compose | installation, restart, health | `bash tests/integration/self_hosted.sh` |
| Reprise | Bash + Compose | sauvegarde/restauration | `bash tests/integration/backup_restore.sh` |
| Performance | Criterion + k6 | parse, recherche, sync | `cargo bench && k6 run tests/load/sync.js` |
| Sécurité | cargo-deny, pnpm audit, tests dédiés | licences, vulnérabilités, contrôles | `cargo deny check && pnpm audit --prod` |

## 7. Risques et mesures de réduction

| Risque | Impact | Mesure |
|---|---|---|
| Perte de données lors d’une concurrence | Critique | versions immuables, opérations idempotentes, tests crash/rejeu, conflit explicite |
| Traversal ou symlink hors coffre | Critique | `VaultPath` validé, résolution canonique, handles relatifs si disponibles, corpus multi-OS |
| Boucles du watcher | Élevé | origine d’opération, hash, debounce et tests de rafales |
| Divergence contrats Rust/TypeScript | Élevé | OpenAPI généré, golden tests et CI anti-dérive |
| Fuite de contenu dans logs/métriques | Élevé | redaction par défaut, tests de capture, labels sans identifiant utilisateur |
| Compromission ou perte de clé E2EE | Critique | clés uniquement en mémoire, enveloppes Argon2id, AAD versionné, documentation d’irréversibilité, revue crypto externe avant release |
| Cache web complet exposé sur un poste partagé | Élevé | IndexedDB ciphertext-only, clé purgée au verrouillage/logout, option d’effacement de l’appareil, CSP stricte |
| Serveur incapable de rechercher/fusionner grâce à E2EE | Moyen | index/recherche/fusion sur le client ; accepter les limites fonctionnelles et ne pas ajouter de clair serveur |
| Partage E2EE mal conçu | Critique | hors MVP ; protocole de distribution/rotation/révocation de clés soumis à audit avant implémentation |
| Service worker servant des données d’un autre compte | Élevé | cache d’assets uniquement, IndexedDB partitionnée par utilisateur, purge au logout |
| SQLite FTS5 absent sur une cible | Moyen | vérifier les builds Tauri par OS ; fallback Tantivy si nécessaire après benchmark |
| WebView Tauri différent selon OS | Moyen | E2E sur Linux/Windows/macOS avant release |
| Tests filesystem instables | Moyen | événements observables, délais bornés, exécution sérialisée ciblée, pas de sleeps arbitraires |
| AGPL des services optionnels | Moyen | services séparés, non requis, obligations documentées et audit `cargo-deny`/licences Node |
| Complexité prématurée du CRDT | Moyen | hors MVP ; synchronisation par révisions et conflits explicites d’abord |
| Nom `Synapse` potentiellement indisponible | Moyen | recherche de marque et renommage avant publication publique |

## 8. Questions ouvertes à trancher avant les tâches concernées

1. Taille maximale par note et par pièce jointe pour le MVP ? À défaut : 10 MiB par note Markdown et 100 MiB par pièce jointe, configurables côté serveur.
2. Durée de rétention des révisions et politique de purge des blobs non référencés ? À défaut : 90 jours de révisions et grâce de 30 jours avant purge des blobs orphelins.
3. Quel nom final utiliser si `Synapse` entre en conflit avec une marque ou un projet existant ?
4. Décision (2026-08-08) : une phrase de déchiffrement est distincte du mot de passe de connexion. Elle dérive localement la clé de wrapping avec Argon2id et ne traverse jamais l’API, les logs, les URL ou le stockage persistant du navigateur.

Les décisions licence AGPLv3, comptes multi-utilisateur avec invitations par défaut, E2EE obligatoire, cache web complet chiffré, Windows/Linux prioritaires et CRDT reportés sont déjà tranchées. Les limites doivent être configurables et recevoir les défauts conservateurs indiqués dans les Tasks 14/17.

## 9. Vérification finale avant préversion

- [ ] Tous les tests ont été observés en RED avant leur implémentation.
- [ ] Aucun code produit sans test correspondant, hors fichiers générés et configuration validée par intégration.
- [ ] Le desktop fonctionne sans serveur et ne bloque jamais l’édition sur le réseau.
- [ ] Le rejeu d’une opération ne crée aucune révision dupliquée.
- [ ] Les conflits préservent toutes les variantes.
- [ ] Le serveur, ses logs, PostgreSQL et le stockage de blobs ne contiennent aucun contenu de coffre en clair.
- [ ] Les clés de coffre ne persistent jamais dans le navigateur ou les logs en clair et sont purgées au verrouillage/logout.
- [ ] Aucun accès filesystem Tauri généraliste ou shell n’est autorisé.
- [ ] Aucun SaaS, compte externe ou option payante n’est requis.
- [ ] Les licences et vulnérabilités sont vérifiées automatiquement.
- [ ] L’installation Compose, le redémarrage et la restauration sont testés.
- [ ] Les budgets de performance proviennent de mesures reproductibles.
- [ ] Le README ne promet que des fonctionnalités et commandes réellement disponibles.
