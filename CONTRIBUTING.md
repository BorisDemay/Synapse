# Contribuer à Synapse

Merci de votre intérêt. Ce projet applique le
[code de conduite](CODE_OF_CONDUCT.md) et la
[politique de sécurité](SECURITY.md).

## Prérequis

- Rust stable (voir `rust-toolchain.toml`) ;
- Node.js 22 et pnpm 11 (`corepack enable`) ;
- Docker Engine et Docker Compose v2 ;
- [`just`](https://github.com/casey/just), `cargo-nextest`, `cargo-deny` ;
- les bibliothèques natives Tauri pour travailler sur le client desktop
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, `patchelf` sous Debian/Ubuntu).

## Mise en place

```bash
pnpm install
just db        # PostgreSQL de test/développement jetable (127.0.0.1:55432)
just dev       # API Rust (:3000) + UI Vite (:5173)
just desktop   # API + fenêtre native Tauri
```

Les commandes détaillées et leurs prérequis sont dans le [README](README.md).

## Méthode

- **Tests d’abord** : écrire un test qui échoue pour la bonne raison, l’exécuter,
  écrire le minimum pour le faire passer, exécuter le test ciblé puis la suite
  concernée, refactoriser seulement une fois vert.
- **Petites tranches verticales** : une fonctionnalité utile de bout en bout,
  sans fusionner avec du travail non demandé.
- **Un commit conventionnel atomique** par tâche verte
  (`feat|fix|docs|test|perf|refactor|chore|security(scope): …`).
- **Ne pas déclarer une fonctionnalité terminée** sans sortie réelle des
  commandes de validation.

## Qualité avant de pousser

```bash
just verify
```

Enchaîne formatage, clippy, tests Rust (workspace et natifs), tests JavaScript,
typechecks, audits de dépendances, parcours Playwright, drills Compose et le
drill de déploiement. Le détail des gates et des prérequis est dans
[docs/operations/ci.md](docs/operations/ci.md).

## Invariants à ne jamais casser

- **Aucun contenu de coffre en clair** — note, titre, chemin, tag, lien, extrait
  ou pièce jointe — ne doit atteindre le serveur, PostgreSQL, le stockage de
  blobs, les journaux, les métriques ou les traces.
- La clé de coffre et la phrase de déchiffrement ne doivent jamais apparaître
  dans `localStorage`, une URL, un journal, une erreur, la télémétrie, un store
  Pinia persisté ou une API serveur.
- **Pas de cryptographie maison** : utiliser les primitives éprouvées
  encapsulées dans `crates/synapse-crypto/`.
- Toute entrée réseau, chemin de fichier et configuration doit être validée ;
  les requêtes SQL sont paramétrées ; les accès Tauri restent allowlistés au
  minimum nécessaire.
- Toute mutation de synchronisation porte un `operation_id` idempotent et une
  `base_revision` ; le serveur ne fusionne jamais de contenu chiffré et ne
  détecte que les versions obsolètes.

## Dépendances et licence

- Ajouter une dépendance seulement si l’alternative standard est insuffisante,
  puis vérifier qu’elle est open source et **compatible AGPLv3**, et justifier
  son rôle dans la pull request. La CI audite licences et vulnérabilités.
- Aucun SaaS, télémétrie distante ou compte tiers obligatoire dans le chemin de
  production.

## Décisions d’architecture

Toute décision d’architecture se consigne dans un ADR sous `docs/adr/`
(contexte, décision, conséquences, alternatives rejetées) et met à jour la
documentation concernée avant ou avec le code.

## Migrations

Les migrations sont rejouables et testées contre une vraie PostgreSQL. Ne jamais
éditer une migration déjà déployée : ajouter un nouveau fichier numéroté. Une
expansion de schéma doit rester lisible par la version serveur précédente.

## Pull requests

- Décrire le problème, l’approche et les commandes exécutées.
- Ne jamais committer de secret, de donnée sensible, de binaire ni de fichier
  généré non reproductible.
- Garder le [README](README.md) honnête : n’y documenter que des commandes et
  capacités réellement vérifiées.

## Licence des contributions

En contribuant, vous acceptez que vos contributions soient distribuées sous
**AGPL-3.0-or-later**, la licence du projet (voir [LICENSE](LICENSE)).
