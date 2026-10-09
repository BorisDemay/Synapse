# ADR 0004 — Séparer le service disque de l’orchestration locale

- Statut : accepté
- Date : 2026-08-08
- Décision : ajouter une couche `synapse-vault-service` après le chiffrement et le protocole

## Contexte

La Task 6 demandait à `synapse-core` d’écrire atomiquement dans le coffre local, de mettre à jour SQLite et d’ajouter une opération à la file de synchronisation. Or `synapse-local-store` dépend déjà de `synapse-core`. Ajouter la dépendance inverse créerait un cycle Cargo.

L’enqueue d’une opération conforme à l’E2EE ne peut pas non plus être implémenté avant que la clé de coffre, l’enveloppe chiffrée, `operation_id`, `base_revision` et le contrat de payload chiffré soient définis.

Enfin, une écriture filesystem et une transaction SQLite ne partagent pas une transaction ACID native. Affirmer qu’elles sont atomiques ensemble serait incorrect.

## Décision

Les dépendances restent acycliques :

```text
synapse-core          # domaine, parsing, validation des chemins, écriture disque
      ▲
      │
synapse-local-store  # SQLite local, index, outbox opaque
      ▲
      │
synapse-vault-service # orchestration disque → index/outbox, récupération
      ├── synapse-crypto
      └── synapse-protocol
```

- `synapse-core` ne dépend jamais de SQLite, de la crypto de synchronisation ou du protocole réseau.
- `synapse-local-store` dépend de `synapse-core` uniquement et expose des opérations de transaction SQLite sur des données typées ou des payloads opaques.
- `synapse-crypto` encapsule les primitives éprouvées et ne dépend pas du serveur.
- `synapse-protocol` définit les enveloppes sérialisables et versionnées ; il ne lit pas le filesystem.
- `synapse-vault-service` dépend de `synapse-core`, `synapse-local-store`, `synapse-crypto` et `synapse-protocol`. Il est le seul endroit qui orchestre une mutation utilisateur complète.

## Stratégie de cohérence

Une mutation locale suit ce flux :

1. Valider le chemin et préparer le contenu.
2. Écrire un fichier temporaire dans le même répertoire, le synchroniser, puis le renommer atomiquement.
3. Recalculer/lire le résultat effectivement écrit.
4. Dans une transaction SQLite unique, mettre à jour l’index, les relations et l’outbox avec le payload déjà chiffré.
5. Marquer l’opération `pending` jusqu’à l’ack serveur.

Il n’existe pas de transaction ACID commune entre les étapes 2 et 4. Un reconciler au démarrage compare le filesystem à l’index et répare les états intermédiaires après crash. L’outbox est transactionnelle avec l’index SQLite ; elle ne peut jamais contenir le Markdown en clair.

## Conséquences

- La Task 6 reste petite, testable et indépendante : elle couvre uniquement le filesystem local sécurisé.
- L’orchestration complète est reportée après les Tasks 11a et 12, lorsque la crypto et le protocole existent.
- La Task 12a ajoutera `crates/synapse-vault-service/` et ses tests d’intégration.
- Les tests doivent couvrir un crash simulé entre écriture disque et commit SQLite, puis vérifier la récupération.
- Le serveur n’est jamais impliqué dans l’index local ni dans la décision de réparation du filesystem.

## Alternatives rejetées

- Faire dépendre `synapse-core` de `synapse-local-store` : cycle Cargo.
- Construire un payload ad hoc dans la Task 6 : protocole et E2EE non définis.
- Prétendre qu’un filesystem et SQLite partagent une transaction atomique : garantie fausse.
- Déplacer le parsing Markdown dans le serveur : incompatible avec l’E2EE.
