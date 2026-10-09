# ADR 0001 — Monorepo et frontières de confiance

- Statut : accepté
- Date : 2026-08-08

## Contexte

Synapse réunit un client desktop Tauri/Vue, un client web Vue et un serveur de
synchronisation Rust. Le MVP doit être local-first, auto-hébergeable et chiffré
de bout en bout sans rendre le serveur dépositaire du contenu des coffres.

## Décision

Le dépôt est un monorepo avec un workspace Cargo pour les frontières sensibles
et un workspace pnpm pour les applications Vue et les packages TypeScript.

- `crates/synapse-core` porte le domaine local, les chemins validés et le
  traitement Markdown.
- `crates/synapse-crypto` isole les primitives éprouvées de chiffrement côté
  client.
- `crates/synapse-local-store` porte l’index SQLite et la file persistante.
- `crates/synapse-protocol` et `crates/synapse-sync` portent les contrats et
  transitions de synchronisation opaques.
- `apps/server` autorise et réplique des objets chiffrés ; il ne reçoit jamais
  de contenu de coffre en clair.
- `apps/desktop` et `apps/web` déchiffrent, indexent et présentent le contenu
  seulement après déverrouillage local.

Les frontières sont typées : les interfaces serveur et de blob acceptent des
ciphertexts, nonces, empreintes de ciphertext, révisions, curseurs et enveloppes
chiffrées, jamais Markdown, titre, chemin, tag, lien ou extrait en clair.

## Conséquences

Les recherches, aperçus et fusions de contenu sont locaux à un client
 déverrouillé. Le serveur ne peut pas fournir de recherche plein texte ni de
fusion automatique. Les clés de coffre et secrets de déchiffrement restent hors
des API serveur, journaux, métriques, traces, URL, `localStorage` et état Pinia
persisté. La phrase de déchiffrement est distincte du mot de passe
d’authentification : elle dérive uniquement la clé de wrapping locale et ne
traverse jamais la frontière HTTP ou WebSocket.

La licence de ce dépôt est AGPL-3.0-or-later. Les dépendances ajoutées doivent
être open source et compatibles avec cette licence. Aucun SaaS ni compte tiers
n’est requis pour exécuter le produit.

## Alternatives rejetées

- Plusieurs dépôts : ils compliquent les changements atomiques de contrat entre
  Rust et TypeScript.
- Un serveur qui analyse ou indexe Markdown : incompatible avec l’E2EE MVP.
- Electron ou React : écartés au profit de Tauri et Vue 3 retenus par le plan.
- Une dépendance à un service cloud géré : contraire à l’auto-hébergement.
