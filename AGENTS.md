# Synapse — Instructions pour agents

## Source de vérité

- Lire `README.md`, puis les ADR sous `docs/adr/` et la documentation d’architecture sous `docs/architecture/`, avant de modifier le produit.
- Ce dépôt construit Synapse : un gestionnaire de coffres Markdown local-first, auto-hébergeable, multi-utilisateur et chiffré de bout en bout.
- Les règles de sécurité, d’E2EE et de synchronisation du plan priment sur les raccourcis de livraison.
- Ne pas modifier une décision d’architecture sans mettre à jour un ADR sous `docs/adr/` et le plan concerné.

## Démarrage d’une tâche

1. Lire la tâche ciblée et ses fichiers dans le plan.
2. Lire les instructions spécialisées applicables :
   - E2EE, secrets, sessions, autorisations ou stockage : `skills/synapse-security/SKILL.md`.
   - Protocole, réplication, opérations, curseurs, WebSocket ou conflits : `skills/synapse-sync/SKILL.md`.
   - Vue, Tauri, SQLx, Docker, CI ou publication : `skills/synapse-delivery/SKILL.md`.
3. Vérifier l’état du dépôt et les commandes disponibles avant toute modification.
4. Déclarer les hypothèses qui ne sont pas couvertes par le plan ; ne pas inventer un protocole ou une primitive cryptographique.

## Discipline de développement

- Appliquer TDD : écrire un test qui échoue pour la bonne raison, l’exécuter, écrire le minimum pour le faire passer, exécuter le test ciblé puis la suite concernée, refactoriser seulement quand tout est vert.
- Travailler par petites tranches verticales. Une tâche du plan peut être subdivisée, mais ne pas être fusionnée avec des fonctionnalités non demandées.
- Ne jamais déclarer une fonctionnalité terminée sans sortie réelle des commandes de validation.
- Un commit Conventional Commit atomique termine chaque tâche verte. Ne pas committer secrets, données de test sensibles, binaires ou fichiers générés non reproductibles.
- Préférer les dépendances open source compatibles AGPLv3. Ajouter une dépendance seulement si l’alternative standard est insuffisante et documenter son rôle et sa licence.

## Invariants de sécurité

- Aucun contenu de coffre en clair — note, titre, chemin, tag, lien, extrait ou pièce jointe — ne doit atteindre le serveur, PostgreSQL, le stockage de blobs, les logs, les métriques ou les traces.
- Les clients chiffrent les contenus avec la clé de coffre ; le serveur stocke et réplique seulement des ciphertexts, des nonces, des empreintes de ciphertext, des révisions et des enveloppes de clés.
- La clé de coffre et les secrets de déchiffrement ne vont jamais dans `localStorage`, URL, logs, erreurs, télémétrie, Pinia persisté ou API serveur.
- Ne pas implémenter de cryptographie maison. Utiliser des primitives éprouvées et les encapsuler derrière `crates/synapse-crypto/`.
- Toute entrée réseau, chemin de fichier et configuration doit être validé. Les opérations SQL sont paramétrées. Les accès Tauri sont allowlistés au minimum nécessaire.
- Ne jamais ajouter de SaaS, télémétrie distante ou compte tiers obligatoire.

## Invariants de synchronisation

- Toute mutation a un `operation_id` idempotent et une `base_revision`.
- Le serveur ne fusionne jamais du contenu de coffre chiffré ; il détecte seulement les versions obsolètes.
- Les conflits conservent les versions base, locale et distante. La fusion trois voies se fait exclusivement dans un client déverrouillé lorsqu’elle est sûre ; sinon, résolution manuelle.
- Le réseau ne bloque jamais l’édition locale. Les opérations restent dans une file persistante jusqu’à un ack explicite.

## Qualité et livraison

- Cibles MVP : Windows et Linux ; ne pas introduire de comportement exclusif à macOS.
- Les migrations sont rejouables et testées avec une vraie PostgreSQL de test.
- Le déploiement minimal doit rester Docker Compose + PostgreSQL + volume de blobs + Caddy, sans option payante.
- Toute opération de sauvegarde doit avoir un scénario de restauration automatisé.
- Garder `README.md` honnête : y documenter uniquement les commandes et capacités réellement vérifiées.

## Outils MCP

- La configuration `.mcp.json` expose uniquement Playwright MCP pour les vérifications locales de l’interface web. L’utiliser seulement contre l’application locale de test.
- Aucun MCP filesystem, shell, PostgreSQL ou GitHub n’est autorisé par défaut : les outils natifs et les commandes testées sont plus restreints et ne nécessitent aucun secret.
- Ne jamais placer un jeton, mot de passe, URL privée ou variable de production dans `.mcp.json`.
